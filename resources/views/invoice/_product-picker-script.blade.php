@push('scripts')
<script>
(() => {
    const invoiceItemsContainer = document.getElementById('invoice-items-container');
    const barcodeInput = document.getElementById('barcode');
    const totalQuantityInput = document.getElementById('total_quantity');
    const totalAmountInput = document.getElementById('total_amount');
    const paidAmountInput = document.getElementById('paid_amount');
    const productSearchUrl = @json(route('invoices.products.search'));
    const initialProducts = new Map((@json($allProducts ?? [])).map(product => [String(product.id), product]));

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
        })[character]);
    }

    function updateInvoiceTotals() {
        let totalQuantity = 0;
        let totalAmount = 0;
        invoiceItemsContainer.querySelectorAll('.invoice-item-row').forEach(row => {
            const quantity = Math.max(0, parseInt(row.querySelector('.item-quantity').value || '0', 10));
            const price = Number(row.dataset.price || 0);
            totalQuantity += quantity;
            totalAmount += price * quantity;
            row.querySelector('.line-total-input').value = totalAmountFor(price, quantity);
        });
        totalQuantityInput.value = totalQuantity;
        totalAmountInput.value = totalAmount.toFixed(2);
        const paid = Number(paidAmountInput.value || 0);
        if (paid > totalAmount) paidAmountInput.value = totalAmount.toFixed(2);
    }

    function totalAmountFor(price, quantity) {
        return (Number(price || 0) * Number(quantity || 0)).toFixed(2);
    }

    async function searchProducts(query) {
        const response = await fetch(`${productSearchUrl}?q=${encodeURIComponent(query)}`, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (!response.ok) throw new Error('Product search failed');
        const body = await response.json();
        return Array.isArray(body.data) ? body.data : [];
    }

    function selectProduct(row, product) {
        const input = row.querySelector('.product-search');
        row.querySelector('.product-id').value = product.id;
        row.dataset.price = product.price;
        input.value = `${product.name} - ${Number(product.price).toFixed(2)} ج.م`;
        row.querySelector('.product-suggestions').replaceChildren();
        updateInvoiceTotals();
    }

    function createInvoiceItemRow(item = { product_id: '', quantity: 1, price: 0 }) {
        const row = document.createElement('div');
        row.className = 'row g-3 invoice-item-row align-items-end mb-2';
        const initial = initialProducts.get(String(item.product_id)) || null;
        const initialPrice = initial?.price ?? item.price ?? 0;
        row.dataset.price = item.product_id ? initialPrice : 0;
        row.innerHTML = `
            <div class="col-md-5 position-relative">
                <label class="form-label">المنتج</label>
                <input type="text" class="form-control product-search" autocomplete="off" placeholder="ابحث بالاسم أو امسح الباركود" value="${escapeHtml(initial?.name ?? item.name ?? '')}" aria-expanded="false">
                <input type="hidden" name="product_ids[]" class="product-id" value="${escapeHtml(item.product_id ?? '')}">
                <div class="list-group product-suggestions position-absolute start-0 end-0 top-100 shadow z-3"></div>
            </div>
            <div class="col-md-3">
                <label class="form-label">الكمية</label>
                <input type="number" name="quantities[]" class="form-control item-quantity" min="1" value="${escapeHtml(item.quantity ?? 1)}">
            </div>
            <div class="col-md-3">
                <label class="form-label">المجموع</label>
                <input type="text" readonly class="form-control line-total-input" value="${totalAmountFor(initialPrice, item.quantity ?? 1)}">
            </div>
            <div class="col-md-1 text-end">
                <button type="button" class="btn btn-danger remove-invoice-item" title="حذف المنتج">×</button>
            </div>`;

        const input = row.querySelector('.product-search');
        const suggestions = row.querySelector('.product-suggestions');
        let timer;
        let searchSequence = 0;

        input.addEventListener('input', () => {
            row.querySelector('.product-id').value = '';
            row.dataset.price = 0;
            updateInvoiceTotals();
            clearTimeout(timer);
            const query = input.value.trim();
            const sequence = ++searchSequence;
            if (query.length < 2) {
                suggestions.replaceChildren();
                return;
            }
            timer = setTimeout(async () => {
                try {
                    const products = await searchProducts(query);
                    if (sequence !== searchSequence) return;
                    suggestions.replaceChildren();
                    products.forEach(product => {
                        const option = document.createElement('button');
                        option.type = 'button';
                        option.className = 'list-group-item list-group-item-action';
                        option.textContent = `${product.name} — ${Number(product.price).toFixed(2)} ج.م`;
                        option.addEventListener('click', () => selectProduct(row, product));
                        suggestions.appendChild(option);
                    });
                } catch {
                    if (sequence === searchSequence) suggestions.replaceChildren();
                }
            }, 250);
        });

        row.querySelector('.item-quantity').addEventListener('input', updateInvoiceTotals);
        row.querySelector('.remove-invoice-item').addEventListener('click', () => {
            row.remove();
            if (!invoiceItemsContainer.querySelector('.invoice-item-row')) createInvoiceItemRow();
            updateInvoiceTotals();
        });
        invoiceItemsContainer.appendChild(row);
    }

    document.getElementById('addInvoiceItemBtn')?.addEventListener('click', () => createInvoiceItemRow());
    (@json($invoiceItems)).forEach(item => createInvoiceItemRow(item));
    if (!invoiceItemsContainer.querySelector('.invoice-item-row')) createInvoiceItemRow();
    updateInvoiceTotals();

    barcodeInput?.addEventListener('keydown', async event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const code = barcodeInput.value.trim();
        if (!code) return;
        try {
            const product = (await searchProducts(code)).find(item => item.barcode === code);
            if (!product) {
                window.showBootstrapAlert('لم يتم العثور على منتج بهذا الباركود', 'warning');
                return;
            }
            createInvoiceItemRow({ product_id: product.id, quantity: 1, price: product.price, name: product.name });
            updateInvoiceTotals();
            barcodeInput.value = '';
        } catch {
            window.showBootstrapAlert('تعذر البحث عن المنتج. تحقق من الاتصال ثم حاول مرة أخرى.', 'danger');
        }
    });
})();
</script>
@endpush
