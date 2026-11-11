<?php

namespace App\Support;

use App\Models\User;

final class ApiPermissionMap
{
    /** @return list<string> */
    public function tokenAbilities(User $user): array
    {
        $user->loadMissing(['permissions', 'roles.permissions']);
        $abilities = ['api:me'];

        foreach (array_keys(config('access.pages', [])) as $page) {
            $view = "page.{$page}.view";
            $manage = "page.{$page}.manage";
            $canManage = $user->can($manage);

            if ($canManage || $user->can($view)) {
                $abilities[] = $view;
            }

            if ($canManage) {
                $abilities[] = $manage;
            }
        }

        return array_values(array_unique($abilities));
    }

    /** @return list<string> */
    public function pagePermissions(User $user): array
    {
        return array_values(array_filter(
            array_slice($this->tokenAbilities($user), 1),
            static fn (string $ability): bool => str_starts_with($ability, 'page.')
        ));
    }
}
