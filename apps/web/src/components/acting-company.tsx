'use client';

/**
 * Super admin only: which company a company-scoped page is editing. Same
 * acting company as the header switcher (X-Company-Id); changing it reloads so
 * every request on the page follows the new company.
 */
import { useAuth } from '@/lib/auth';
import { getActingCompanyId, setActingCompanyId } from '@/lib/api';
import { useFetch } from '@/lib/useFetch';
import { Select } from '@/components/ui';

/** Opens a company-scoped page as the super admin, acting in `companyId`. */
export function openAsCompany(companyId: string, path: string) {
  setActingCompanyId(companyId);
  window.location.assign(path);
}

export function ActingCompanyBar({ label }: { label: string }) {
  const { session } = useAuth();
  const isSuper = session?.role === 'SUPER_ADMIN';
  const { data: companies } = useFetch<{ id: string; name: string; code: string }[]>(isSuper ? '/superadmin/companies' : null);
  if (!isSuper || !companies?.length) return null;
  const acting = getActingCompanyId() ?? '';
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 px-4 py-3">
      <span className="text-sm font-medium text-brand-900">{label}</span>
      <div className="w-72">
        <Select
          value={acting}
          onChange={(e) => {
            setActingCompanyId(e.target.value);
            window.location.reload();
          }}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </Select>
      </div>
      <span className="text-xs text-brand-700/80">Changes apply to the selected company only.</span>
    </div>
  );
}
