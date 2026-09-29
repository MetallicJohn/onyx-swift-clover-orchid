export const COMPANY_INFO_TABS = [
  { id: "basic", label: "Basic information" },
  { id: "contact", label: "Contact information" },
  { id: "branding", label: "Branding" },
  { id: "legal", label: "Business / legal" },
  { id: "etims", label: "eTIMS" },
  { id: "additional", label: "Additional information" },
] as const;

export type CompanyInfoTabId = (typeof COMPANY_INFO_TABS)[number]["id"];

export const COMPANY_SAVE_OK = "Company information saved successfully.";
export const COMPANY_SAVE_FAIL = "Unable to save company information. Please try again.";
export const PASSWORD_SAVE_OK = "Password updated successfully.";

export type CompanyProfileFields = {
  name: string;
  supportEmail: string;
  supportPhone: string;
  dateFormat: string;
};

export type CompanyBrandFields = {
  address: string;
  website: string;
  tax_pin: string;
  invoice_footer: string;
  invoice_notes: string;
  brand_color: string;
  bank_name: string;
  bank_account: string;
  bank_branch: string;
};

export function isCompanyInfoTab(value: string): value is CompanyInfoTabId {
  return COMPANY_INFO_TABS.some((tab) => tab.id === value);
}

export function companySaveError(err: unknown) {
  if (err instanceof Error && err.message.trim()) return err.message.trim();
  return COMPANY_SAVE_FAIL;
}

export function basicInfoComplete(name: string) {
  return name.trim().length > 0;
}

export function companyProfileDirty(profile: CompanyProfileFields, saved: CompanyProfileFields) {
  return (
    profile.name !== saved.name ||
    profile.supportEmail !== saved.supportEmail ||
    profile.supportPhone !== saved.supportPhone ||
    profile.dateFormat !== saved.dateFormat
  );
}

export function companyBrandDirty(brand: CompanyBrandFields, saved: CompanyBrandFields) {
  return (Object.keys(saved) as (keyof CompanyBrandFields)[]).some((key) => brand[key] !== saved[key]);
}

/** Keep keystrokes made after a save was submitted; take the server value for everything else. */
export function mergeKeptEdits<T extends object>(current: T, submitted: T, server: T): T {
  const next = { ...server };
  for (const key of Object.keys(submitted) as (keyof T)[]) {
    if (current[key] !== submitted[key]) next[key] = current[key];
  }
  return next;
}

export function companyTabDirty(
  tab: CompanyInfoTabId,
  profile: CompanyProfileFields,
  savedProfile: CompanyProfileFields,
  brand: CompanyBrandFields,
  savedBrand: CompanyBrandFields,
  passwordDirty: boolean,
) {
  if (tab === "basic") return profile.name !== savedProfile.name;
  if (tab === "contact") {
    return (
      profile.supportEmail !== savedProfile.supportEmail ||
      profile.supportPhone !== savedProfile.supportPhone ||
      brand.address !== savedBrand.address ||
      brand.website !== savedBrand.website
    );
  }
  if (tab === "legal") {
    return (
      brand.tax_pin !== savedBrand.tax_pin ||
      brand.bank_name !== savedBrand.bank_name ||
      brand.bank_account !== savedBrand.bank_account ||
      brand.bank_branch !== savedBrand.bank_branch ||
      brand.invoice_notes !== savedBrand.invoice_notes ||
      brand.invoice_footer !== savedBrand.invoice_footer ||
      brand.brand_color !== savedBrand.brand_color
    );
  }
  if (tab === "additional") return profile.dateFormat !== savedProfile.dateFormat || passwordDirty;
  return false;
}
