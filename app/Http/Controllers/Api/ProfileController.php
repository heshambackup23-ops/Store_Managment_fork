<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\UpdateProfileRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ProfileController
{
    public function show(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->resource($request->user())]);
    }

    public function update(UpdateProfileRequest $request): JsonResponse
    {
        $user = $request->user();
        $validated = $request->validated();
        $user->forceFill(array_intersect_key($validated, array_flip(['name', 'email'])));
        if (! empty($validated['password'])) {
            $user->password = $validated['password'];
        }
        $user->save();

        return response()->json(['data' => $this->resource($user->refresh())]);
    }

    private function resource($user): array
    {
        return [
            'id' => $user->id,
            'name' => $user->name,
            'username' => $user->username,
            'email' => $user->email,
        ];
    }
}
