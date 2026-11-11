<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

class PictureStorageService
{
    private const MIME_EXTENSIONS = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'image/webp' => 'webp',
    ];

    private const MAX_DIMENSION = 6000;

    /** Never raise PHP's memory limit above this for a single upload. */
    private const MEMORY_CEILING_BYTES = 512 * 1024 * 1024;

    public function productUrl(\App\Models\products $product, bool $thumbnail = true): ?string
    {
        if (! $product->image) {
            return null;
        }

        return route('media.products.image', [
            'product' => $product->getKey(),
            'thumbnail' => $thumbnail ? 1 : 0,
            'v' => substr(hash('sha256', (string) $product->image), 0, 12),
        ]);
    }

    public function productResponse(?string $storedPath, string $legacyFolder, bool $thumbnail): Response
    {
        abort_if(! $storedPath, 404);

        $path = ltrim(str_replace('\\', '/', $storedPath), '/');
        abort_if(str_contains($path, "\0") || in_array('..', explode('/', $path), true), 404);

        $isLegacyPublicPath = str_starts_with($path, 'uploads/');
        if (! str_contains($path, '/') && ! $isLegacyPublicPath) {
            $path = 'uploads/'.$legacyFolder.'/'.basename($path);
            $isLegacyPublicPath = true;
        }

        if ($thumbnail && ! $isLegacyPublicPath) {
            $thumbnailPath = dirname($path).'/thumbnails/'.basename($path);
            if (Storage::disk('public')->exists($thumbnailPath)) {
                $path = $thumbnailPath;
            }
        }

        $headers = [
            'Cache-Control' => 'public, max-age=86400, stale-while-revalidate=604800',
            'X-Content-Type-Options' => 'nosniff',
        ];

        if ($isLegacyPublicPath) {
            $filePath = public_path($path);
            abort_unless(File::exists($filePath), 404);

            return response()->file($filePath, $headers);
        }

        abort_unless(Storage::disk('public')->exists($path), 404);

        return Storage::disk('public')->response($path, basename($path), $headers);
    }

    public function store(UploadedFile $file, string $folder): string
    {
        if (!extension_loaded('gd') || !function_exists('imagecreatefromstring')) {
            throw new RuntimeException('The GD extension is required to process uploaded pictures.');
        }

        $realPath = $file->getRealPath();
        $imageInfo = $realPath ? @getimagesize($realPath) : false;
        $mime = is_array($imageInfo) ? ($imageInfo['mime'] ?? '') : '';

        if (!isset(self::MIME_EXTENSIONS[$mime])
            || $imageInfo[0] > self::MAX_DIMENSION
            || $imageInfo[1] > self::MAX_DIMENSION) {
            throw new RuntimeException('The uploaded picture is not a supported image or exceeds the allowed dimensions.');
        }

        // A large photo can exhaust PHP's memory (a fatal error nobody can catch). Check first.
        $this->ensureMemory((int) $imageInfo[0], (int) $imageInfo[1]);

        $image = @imagecreatefromstring((string) file_get_contents($realPath));
        if (!$image instanceof \GdImage) {
            throw new RuntimeException('The uploaded picture could not be decoded.');
        }

        // Re-encoding strips EXIF, so phone photos would end up sideways without this.
        $image = $this->applyExifOrientation($image, $mime, $realPath);

        // Without these two calls PNG/WebP transparency turns black on re-encode.
        if ($mime !== 'image/jpeg') {
            imagealphablending($image, false);
            imagesavealpha($image, true);
        }

        $folder = trim($folder, '/');
        $filename = (string) Str::uuid().'.'.self::MIME_EXTENSIONS[$mime];
        $path = $folder.'/'.$filename;
        $thumbnailPath = $folder.'/thumbnails/'.$filename;
        $disk = Storage::disk('public');

        try {
            if (!$disk->put($path, $this->encode($image, $mime))) {
                throw new RuntimeException('The uploaded picture could not be saved.');
            }

            if (!$disk->put($thumbnailPath, $this->thumbnail($image, $mime))) {
                throw new RuntimeException('The picture thumbnail could not be saved.');
            }
        } catch (\Throwable $exception) {
            $disk->delete([$path, $thumbnailPath]);
            throw $exception;
        }

        return $path;
    }

    public function url(?string $path, string $legacyFolder, bool $thumbnail = false): ?string
    {
        if (!$path) {
            return null;
        }

        $path = ltrim(str_replace('\\', '/', $path), '/');
        if (str_contains($path, '..')) {
            return null;
        }

        if (str_starts_with($path, 'uploads/')) {
            return asset($path);
        }

        if (!str_contains($path, '/')) {
            return asset('uploads/'.$legacyFolder.'/'.basename($path));
        }

        if ($thumbnail) {
            $thumbnailPath = dirname($path).'/thumbnails/'.basename($path);
            if (Storage::disk('public')->exists($thumbnailPath)) {
                $path = $thumbnailPath;
            }
        }

        // asset() follows the address the browser used (localhost, LAN IP, hostname).
        // Storage::url() is built from APP_URL, so other PCs on the network got broken images.
        return asset('storage/'.$path);
    }

    public function delete(?string $path, string $legacyFolder): void
    {
        if (!$path) {
            return;
        }

        $path = ltrim(str_replace('\\', '/', $path), '/');
        if (str_contains($path, '..')) {
            return;
        }

        if (str_starts_with($path, 'uploads/')) {
            File::delete(public_path($path));

            return;
        }

        if (!str_contains($path, '/')) {
            File::delete(public_path('uploads/'.$legacyFolder.'/'.basename($path)));

            return;
        }

        Storage::disk('public')->delete([
            $path,
            dirname($path).'/thumbnails/'.basename($path),
        ]);
    }

    private function ensureMemory(int $width, int $height): void
    {
        $limit = $this->memoryLimitBytes();
        if ($limit === -1) {
            return;
        }

        // GD keeps about 4 bytes per pixel. Decode + rotate + resample peaks near 3 copies.
        $needed = $width * $height * 4 * 3 + memory_get_usage(true) + 16 * 1024 * 1024;
        if ($needed <= $limit) {
            return;
        }

        if ($needed > self::MEMORY_CEILING_BYTES || @ini_set('memory_limit', (string) $needed) === false) {
            throw new RuntimeException('The picture is too large to process. Please use a smaller image.');
        }
    }

    private function memoryLimitBytes(): int
    {
        $raw = trim((string) ini_get('memory_limit'));
        if ($raw === '' || $raw === '-1') {
            return -1;
        }

        $value = (int) $raw;

        return match (strtolower(substr($raw, -1))) {
            'g' => $value * 1024 ** 3,
            'm' => $value * 1024 ** 2,
            'k' => $value * 1024,
            default => $value,
        };
    }

    private function applyExifOrientation(\GdImage $image, string $mime, string $path): \GdImage
    {
        if ($mime !== 'image/jpeg' || !function_exists('exif_read_data')) {
            return $image;
        }

        $exif = @exif_read_data($path);
        $orientation = is_array($exif) ? (int) ($exif['Orientation'] ?? 1) : 1;

        $angle = match ($orientation) {
            3 => 180,
            6 => -90,
            8 => 90,
            default => 0,
        };

        if ($angle === 0) {
            return $image;
        }

        $rotated = imagerotate($image, $angle, 0);

        return $rotated instanceof \GdImage ? $rotated : $image;
    }

    private function encode(\GdImage $image, string $mime): string
    {
        ob_start();
        $saved = match ($mime) {
            'image/jpeg' => imagejpeg($image, null, 86),
            'image/png' => imagepng($image, null, 6),
            'image/webp' => function_exists('imagewebp') ? imagewebp($image, null, 82) : false,
            default => false,
        };
        $contents = ob_get_clean();

        if (!$saved || !is_string($contents)) {
            throw new RuntimeException('The picture format cannot be re-encoded by this GD build.');
        }

        return $contents;
    }

    private function thumbnail(\GdImage $source, string $mime): string
    {
        $sourceWidth = imagesx($source);
        $sourceHeight = imagesy($source);
        $scale = min(1, 320 / max($sourceWidth, $sourceHeight));
        $width = max(1, (int) round($sourceWidth * $scale));
        $height = max(1, (int) round($sourceHeight * $scale));
        $thumbnail = imagecreatetruecolor($width, $height);

        if ($mime !== 'image/jpeg') {
            imagealphablending($thumbnail, false);
            imagesavealpha($thumbnail, true);
            $transparent = imagecolorallocatealpha($thumbnail, 255, 255, 255, 127);
            imagefilledrectangle($thumbnail, 0, 0, $width, $height, $transparent);
        }

        imagecopyresampled($thumbnail, $source, 0, 0, 0, 0, $width, $height, $sourceWidth, $sourceHeight);

        return $this->encode($thumbnail, $mime);
    }
}
