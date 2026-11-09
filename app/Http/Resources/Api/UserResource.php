<?php

namespace App\Http\Resources\Api;

use App\Support\ApiPermissionMap;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'username' => $this->username,
            'roles' => $this->getRoleNames()->values(),
            'permissions' => app(ApiPermissionMap::class)->pagePermissions($this->resource),
        ];
    }
}
