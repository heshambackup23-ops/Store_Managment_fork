<?php

// Invoked only by the CI rehearsal with the original checkout as its working directory.
require getcwd().'/vendor/autoload.php';
$app = require getcwd().'/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!$app->environment('testing') || config('database.connections.mysql.database') !== 'hilal_migration_restored') {
    throw new RuntimeException('This fixture must only export the restored synthetic rehearsal database.');
}
try {
    $request = Illuminate\Http\Request::create('/api/v1/backup/export', 'GET');
    $app->make(App\Http\Controllers\BackupController::class)->apiExport($request)->sendContent();
} catch (Throwable $error) {
    fwrite(STDERR, get_class($error).': '.$error->getMessage().PHP_EOL);
    exit(1);
}
