@php
    $search = request('search');
@endphp
<form method="GET" action="{{ $action ?? url()->current() }}" class="mt-3 mb-4 d-flex align-items-center gap-2 flex-wrap w-100" role="search">
    @foreach(($hiddenFilters ?? []) as $filter => $value)
        <input type="hidden" name="{{ $filter }}" value="{{ $value }}">
    @endforeach
    @if(request()->routeIs('installments.index') && request()->filled('type'))
        <input type="hidden" name="type" value="{{ request('type') }}">
    @endif
    <input type="search" name="search" class="form-control flex-grow-1" placeholder="{{ $placeholder ?? 'ابحث هنا ...' }}" value="{{ $search }}" autocomplete="off">
    <button type="submit" class="btn btn-outline-secondary">بحث</button>
    @if($search)
        <a href="{{ request()->fullUrlWithQuery(['search' => null, 'page' => null]) }}" class="btn btn-outline-danger">مسح</a>
    @endif
</form>
