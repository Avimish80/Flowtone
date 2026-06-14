import { getPreferredCurrency } from "@/lib/currencyCache";

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
    const resolved = code || getPreferredCurrency();
    return CURRENCY_SYMBOLS[resolved] || resolved;
}

export function formatMoney(amount: number | null | undefined, currency?: string | null): string {
    const sym = currencySymbol(currency);
    return `${sym}${(amount || 0).toFixed(2)}`;
}