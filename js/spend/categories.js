// Spending categories. 15 main expense categories (research: 10–20 is the sweet spot), optional
// subcategories for Pro input, and a needs/wants tag per category for the 50/30/20 view.
// The list is editable on Spending → Categories; edits are stored in settings.categories.
import { getSettings, saveSettings } from '../store.js';

export const EXPENSE_DEFAULTS = [
  { id: 'housing', name: 'Housing', emoji: '🏠', kind: 'need', subs: ['Rent', 'Mortgage', 'Maintenance & repairs', 'Home insurance'] },
  { id: 'bills', name: 'Utilities & bills', emoji: '💡', kind: 'need', subs: ['Electricity', 'Water', 'Heating & gas', 'Internet', 'Phone'] },
  { id: 'groceries', name: 'Groceries', emoji: '🛒', kind: 'need', subs: ['Supermarket', 'Market & bakery', 'Household supplies'] },
  { id: 'dining', name: 'Eating out', emoji: '🍽️', kind: 'want', subs: ['Restaurants', 'Cafés & coffee', 'Takeaway & delivery', 'Bars & nights out'] },
  { id: 'transport', name: 'Transport', emoji: '🚗', kind: 'need', subs: ['Fuel', 'Public transport', 'Taxi & rideshare', 'Parking & tolls', 'Car maintenance', 'Car insurance'] },
  { id: 'health', name: 'Health & fitness', emoji: '💊', kind: 'need', subs: ['Pharmacy', 'Doctor & dentist', 'Health insurance', 'Gym & sport'] },
  { id: 'shopping', name: 'Shopping', emoji: '🛍️', kind: 'want', subs: ['Clothes & shoes', 'Electronics', 'Home & furniture', 'Collectibles & hobbies'] },
  { id: 'fun', name: 'Entertainment', emoji: '🎉', kind: 'want', subs: ['Events & concerts', 'Games', 'Books & media', 'Activities'] },
  { id: 'subscriptions', name: 'Subscriptions', emoji: '📺', kind: 'want', subs: ['Streaming', 'Software & apps', 'Memberships', 'News'] },
  { id: 'travel', name: 'Travel', emoji: '✈️', kind: 'want', subs: ['Flights', 'Accommodation', 'Local transport', 'Activities & food'] },
  { id: 'personal', name: 'Personal care', emoji: '💇', kind: 'want', subs: ['Haircut & beauty', 'Cosmetics & toiletries'] },
  { id: 'education', name: 'Education', emoji: '📚', kind: 'need', subs: ['Courses', 'Books & materials', 'Tuition'] },
  { id: 'gifts', name: 'Gifts & donations', emoji: '🎁', kind: 'want', subs: ['Gifts', 'Charity'] },
  { id: 'fees', name: 'Taxes & fees', emoji: '🧾', kind: 'need', subs: ['Taxes', 'Bank fees', 'Fines', 'Insurance (other)'] },
  { id: 'other', name: 'Other', emoji: '📦', kind: 'want', subs: [] },
];
export const KINDS = { need: 'Need', want: 'Want' };

export const expenseCats = () => getSettings().categories || EXPENSE_DEFAULTS;
const UNKNOWN = { id: '?', name: 'Uncategorised', emoji: '❔', kind: 'want', subs: [] };
export const catById = id => expenseCats().find(c => c.id === id) || { ...UNKNOWN, id: id || '?', name: id ? `${id} (deleted category)` : 'Uncategorised' };
const catName = id => catById(id).name;
const catEmoji = id => catById(id).emoji || '•';
export const catLabel = id => `${catEmoji(id)} ${catName(id)}`;

// stable colour per category from the chart palette
export const catColor = (id, palette) => {
  const list = expenseCats();
  const i = list.findIndex(c => c.id === id);
  return palette.series[(i < 0 ? 7 : i) % palette.series.length];
};

// a transaction's need/want (Pro can override per transaction)
export const kindOf = t => (t.kind === 'need' || t.kind === 'want' ? t.kind : catById(t.category).kind || 'want');

export async function saveCategories(list) {
  await saveSettings({ categories: list });
}
export const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'cat';
