'use client';

/**
 * Opens a protected file (payslip, document, letter …) in the HRMS viewer tab
 * (/file). The viewer asks the API — which checks access — for a 5-minute
 * signed link, shows the file with a countdown and Download, and shows a
 * friendly "link expired" screen afterwards instead of the storage error.
 */
export async function openSecureFile(path: string): Promise<void> {
  const tab = window.open(`/file?src=${encodeURIComponent(path)}`, '_blank');
  if (tab) tab.opener = null;
}
