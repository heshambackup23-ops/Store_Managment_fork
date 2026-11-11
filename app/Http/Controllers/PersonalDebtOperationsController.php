<?php

namespace App\Http\Controllers;

use App\Models\PersonalDebt;
use App\Services\PersonalDebtService;
use Illuminate\Http\Request;

class PersonalDebtOperationsController extends Controller
{
    public function create()
    {
        return view('personal-debts.create');
    }

    public function store(Request $request, PersonalDebtService $service)
    {
        $service->create($this->validatedCreate($request), $request->user());

        return redirect()->route('installments.index')->with('success', 'تم تسجيل الدين الشخصي.');
    }

    public function edit(PersonalDebt $personalDebt)
    {
        return view('personal-debts.edit', ['debt' => $personalDebt]);
    }

    public function update(Request $request, PersonalDebt $personalDebt, PersonalDebtService $service)
    {
        $service->update($personalDebt, $this->validatedUpdate($request));

        return redirect()->route('installments.index')->with('success', 'تم تحديث الدين الشخصي.');
    }

    public function showPay(PersonalDebt $personalDebt)
    {
        if ($personalDebt->status === 'paid' || (float) $personalDebt->remaining <= 0) {
            return redirect()->route('installments.index')->with('error', 'هذا الدين مسدد بالكامل.');
        }

        return view('personal-debts.pay', ['debt' => $personalDebt]);
    }

    public function pay(Request $request, PersonalDebt $personalDebt, PersonalDebtService $service)
    {
        $validated = $request->validate([
            'amount' => ['required', 'numeric', 'decimal:0,2', 'min:0.01'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);
        $service->pay($personalDebt, $validated['amount'], $validated['notes'] ?? null, $request->user());

        return redirect()->route('installments.index')->with('success', 'تم تسجيل دفعة الدين الشخصي.');
    }

    public function destroy(PersonalDebt $personalDebt, PersonalDebtService $service)
    {
        $service->delete($personalDebt);

        return redirect()->route('installments.index')->with('success', 'تم حذف الدين الشخصي.');
    }

    private function validatedCreate(Request $request): array
    {
        return $request->validate([
            'creditor' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:255'],
            'total_amount' => ['required', 'numeric', 'decimal:0,2', 'min:0.01', 'max:999999999'],
            'paid_amount' => ['nullable', 'numeric', 'decimal:0,2', 'min:0', 'max:999999999'],
            'due_date' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);
    }

    private function validatedUpdate(Request $request): array
    {
        return $request->validate([
            'creditor' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:255'],
            'total_amount' => ['required', 'numeric', 'decimal:0,2', 'min:0.01', 'max:999999999'],
            'due_date' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);
    }
}
