export function createPageUrl(pageName: string) {
    return '/' + pageName.replace(/ /g, '-');
}

const CURRENCY_SYMBOLS: Record<string, string> = {
    GBP: "£",
    USD: "$",
    EUR: "€",
    AUD: "A$",
    CAD: "C$",
};

export function currencySymbol(code?: string | null): string {
    if (!code) return "£";
    return CURRENCY_SYMBOLS[code] || code;
}

export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
    const sym = currencySymbol(currency);
    return `${sym}${(amount || 0).toFixed(2)}`;
}