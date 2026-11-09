<?php

namespace App\Services;

use App\Models\ApiIdempotencyRecord;
use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class ApiIdempotencyService
{
    /**
     * @param  array<string, mixed>  $payload
     * @param  callable(): array{status:int,body:array<string,mixed>}  $operation
     */
    public function execute(
        User $user,
        string $operationName,
        string $key,
        array $payload,
        callable $operation
    ): JsonResponse {
        $requestHash = $this->hash($payload);

        try {
            $result = DB::transaction(function () use ($user, $operationName, $key, $requestHash, $operation): array {
                $record = ApiIdempotencyRecord::query()->create([
                    'user_id' => $user->id,
                    'operation' => $operationName,
                    'idempotency_key' => $key,
                    'request_hash' => $requestHash,
                ]);
                $result = $operation();

                $record->forceFill([
                    'response_status' => $result['status'],
                    'response_body' => $result['body'],
                ])->save();

                return $result;
            }, 3);

            return response()->json($result['body'], $result['status']);
        } catch (QueryException $exception) {
            $record = ApiIdempotencyRecord::query()
                ->where('user_id', $user->id)
                ->where('operation', $operationName)
                ->where('idempotency_key', $key)
                ->first();

            if (! $record) {
                throw $exception;
            }

            if (! hash_equals($record->request_hash, $requestHash)) {
                return response()->json([
                    'message' => 'This idempotency key was already used for a different request.',
                    'error_code' => 'IDEMPOTENCY_KEY_REUSED',
                ], 409);
            }

            if ($record->response_status === null || $record->response_body === null) {
                return response()->json([
                    'message' => 'This operation is still being processed.',
                    'error_code' => 'OPERATION_IN_PROGRESS',
                ], 409);
            }

            return response()->json($record->response_body, $record->response_status);
        }
    }

    private function hash(array $payload): string
    {
        return hash('sha256', json_encode(
            $this->normalize($payload),
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
        ));
    }

    private function normalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }

        if (! array_is_list($value)) {
            ksort($value);
        }

        foreach ($value as $key => $nested) {
            $value[$key] = $this->normalize($nested);
        }

        return $value;
    }
}
