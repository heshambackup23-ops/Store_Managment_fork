<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\Api\UserResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class UserController
{
    public function show(Request $request): JsonResponse
    {
        $user = $request->user()->loadMissing('roles');

        return response()->json(['data' => (new UserResource($user))->resolve($request)]);
    }

    public function legacy(Request $request): JsonResponse
    {
        return response()->json($request->user());
    }
}
