<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\IssueTokenRequest;
use App\Http\Resources\Api\UserResource;
use App\Models\User;
use App\Support\ApiPermissionMap;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\PersonalAccessToken;

class AuthController
{
    public function store(IssueTokenRequest $request, ApiPermissionMap $permissions): JsonResponse
    {
        $data = $request->validated();
        $user = User::query()->where('username', $data['username'])->first();

        if (! $user || ! $user->is_active || ! Hash::check($data['password'], $user->getAuthPassword())) {
            return response()->json([
                'message' => 'The provided credentials are incorrect.',
                'error_code' => 'AUTHENTICATION_FAILED',
            ], 401);
        }

        $expiresAt = now()->addMinutes((int) config('sanctum.expiration'));
        $token = $user->createToken($data['device_name'], $permissions->tokenAbilities($user), $expiresAt);
        $user->loadMissing('roles');

        return response()->json([
            'data' => [
                'access_token' => $token->plainTextToken,
                'token_type' => 'Bearer',
                'expires_at' => $token->accessToken->expires_at?->toIso8601String(),
                'user' => (new UserResource($user))->resolve($request),
            ],
        ], 201);
    }

    public function destroy(Request $request): JsonResponse
    {
        $token = $request->user()->currentAccessToken();

        if (! $token instanceof PersonalAccessToken) {
            return response()->json([
                'message' => 'A personal access token is required.',
                'error_code' => 'TOKEN_REQUIRED',
            ], 401);
        }

        $token->delete();

        return response()->json(null, 204);
    }
}
