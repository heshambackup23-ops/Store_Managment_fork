<?php

namespace App\Http\Controllers;

use App\Http\Requests\SaveDamagedItemRequest;
use App\Models\DamagedItem;
use App\Models\products;
use App\Services\DamagedStockService;
use App\Services\PictureStorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * هالِك: damaged / written-off stock.
 */
class DamagedItemController extends Controller
{
    private const PICTURE_FOLDER = 'damaged';

    public function index(Request $request)
    {
        $filters = $request->validate([
            'q' => ['nullable', 'string', 'max:80'],
            'reason' => ['nullable', Rule::in(array_keys(DamagedItem::REASONS))],
            'status' => ['nullable', Rule::in(['recorded', 'voided'])],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
        ]);

        $query = DamagedItem::query()
            ->when(! empty($filters['q']), function ($query) use ($filters) {
                $query->where('product_name', 'like', '%'.addcslashes(trim($filters['q']), '%_\\').'%');
            })
            ->when(! empty($filters['reason']), fn ($query) => $query->where('reason', $filters['reason']))
            ->when(! empty($filters['status']), fn ($query) => $query->where('status', $filters['status']))
            ->when(! empty($filters['from']), fn ($query) => $query->whereDate('damaged_on', '>=', $filters['from']))
            ->when(! empty($filters['to']), fn ($query) => $query->whereDate('damaged_on', '<=', $filters['to']));

        // Totals never count voided records.
        $totals = fn ($builder) => $builder->where('status', 'recorded')
            ->selectRaw('COUNT(*) AS records, COALESCE(SUM(quantity), 0) AS units, COALESCE(SUM(total_value), 0) AS value')
            ->first();

        $summary = [
            'filtered' => $totals(clone $query),
            'today' => $totals(DamagedItem::query()->whereDate('damaged_on', now()->toDateString())),
            'month' => $totals(DamagedItem::query()->whereDate('damaged_on', '>=', now()->startOfMonth()->toDateString())),
        ];

        $items = $query->orderByDesc('damaged_on')->orderByDesc('id')->paginate(20)->withQueryString();

        return view('damaged.index', [
            'items' => $items,
            'summary' => $summary,
            'filters' => $filters,
            'reasons' => DamagedItem::REASONS,
        ]);
    }

    public function create(Request $request)
    {
        // After a failed submit the previously chosen product is restored from the old input.
        $productId = $request->old('product_id') ?? $request->query('product');
        $preselected = $productId ? products::query()->find((int) $productId) : null;

        return view('damaged.form', [
            'reasons' => DamagedItem::REASONS,
            'today' => now()->toDateString(),
            'preselected' => $preselected,
        ]);
    }

    public function store(SaveDamagedItemRequest $request, DamagedStockService $service, PictureStorageService $pictures): RedirectResponse
    {
        $imagePath = null;

        if ($request->hasFile('image')) {
            try {
                $imagePath = $pictures->store($request->file('image'), self::PICTURE_FOLDER);
            } catch (\RuntimeException $exception) {
                report($exception);

                throw ValidationException::withMessages([
                    'image' => 'تعذر معالجة الصورة. استخدم صورة JPG أو PNG أو WebP بحجم أصغر.',
                ]);
            }
        }

        try {
            $item = $service->record($request->validated(), $request->user(), $imagePath, $request->ip());
        } catch (\Throwable $exception) {
            $pictures->delete($imagePath, self::PICTURE_FOLDER);

            throw $exception;
        }

        // A repeated submit returns the first record, so the extra upload is not needed.
        if ($imagePath !== null && $item->image_path !== $imagePath) {
            $pictures->delete($imagePath, self::PICTURE_FOLDER);
        }

        return redirect()->route('damaged.show', $item)->with('success', 'تم تسجيل الهالك وخصم الكمية من المخزون.');
    }

    public function show(DamagedItem $item)
    {
        $item->load('product:id,name,stock');

        return view('damaged.show', ['item' => $item]);
    }

    public function void(Request $request, DamagedItem $item, DamagedStockService $service): RedirectResponse
    {
        $data = $request->validate(
            ['reason' => ['required', 'string', 'min:3', 'max:255']],
            [],
            ['reason' => 'سبب الإلغاء']
        );

        $service->void($item, $data['reason'], $request->user(), $request->ip());

        return redirect()->route('damaged.show', $item)
            ->with('success', 'تم إلغاء السجل وإرجاع الكمية إلى المخزون.');
    }

    public function report(Request $request)
    {
        $filters = $request->validate([
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
        ]);

        $from = $filters['from'] ?? now()->startOfMonth()->toDateString();
        $to = $filters['to'] ?? now()->toDateString();

        $base = fn () => DamagedItem::query()
            ->where('status', 'recorded')
            ->whereDate('damaged_on', '>=', $from)
            ->whereDate('damaged_on', '<=', $to);

        $totals = $base()
            ->selectRaw('COUNT(*) AS records, COALESCE(SUM(quantity), 0) AS units, COALESCE(SUM(total_value), 0) AS value')
            ->first();

        $byReason = $base()
            ->selectRaw('reason, COUNT(*) AS records, SUM(quantity) AS units, SUM(total_value) AS value')
            ->groupBy('reason')->orderByDesc('value')->get();

        $topProducts = $base()
            ->selectRaw('product_name, SUM(quantity) AS units, SUM(total_value) AS value')
            ->groupBy('product_name')->orderByDesc('value')->limit(10)->get();

        $daily = $base()
            ->selectRaw('damaged_on, COUNT(*) AS records, SUM(quantity) AS units, SUM(total_value) AS value')
            ->groupBy('damaged_on')->orderBy('damaged_on')->get();

        return view('damaged.report', compact('from', 'to', 'totals', 'byReason', 'topProducts', 'daily'));
    }

    /** Product lookup for the form: by name or barcode, small result set. */
    public function searchProducts(Request $request, PictureStorageService $pictures): JsonResponse
    {
        $validated = $request->validate(['q' => ['nullable', 'string', 'max:100']]);
        $term = trim((string) ($validated['q'] ?? ''));

        $query = products::query()->select(['id', 'name', 'price', 'barcode', 'stock', 'image']);

        if ($term !== '') {
            foreach (array_slice(preg_split('/\s+/u', $term, -1, PREG_SPLIT_NO_EMPTY) ?: [], 0, 5) as $word) {
                $like = '%'.addcslashes($word, '%_\\').'%';
                $query->where(fn ($q) => $q->where('name', 'like', $like)->orWhere('barcode', 'like', $like));
            }
        }

        $data = $query
            ->orderByRaw('barcode = ? DESC', [$term])
            ->orderBy('name')
            ->limit(20)
            ->get()
            ->map(fn (products $product) => [
                'id' => $product->id,
                'name' => $product->name,
                'barcode' => $product->barcode,
                'stock' => (int) $product->stock,
                'price' => number_format((float) $product->price, 2, '.', ''),
                'image_url' => $pictures->productUrl($product, true),
            ])->values();

        return response()->json(['data' => $data]);
    }
}
