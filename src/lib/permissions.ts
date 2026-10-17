// Permission catalog — shared by backend validation and the Roles UI
export const MODULES: { module: string; label: string; actions: string[]; actionLabels: Record<string, string> }[] = [
  {
    module: 'dashboard',
    label: 'Dashboard',
    actions: ['view'],
    actionLabels: { view: 'View' },
  },
  {
    module: 'projects',
    label: 'Project Management',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'clients',
    label: 'Client Management',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'staff',
    label: 'Staff Management',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'attendance',
    label: 'Attendance',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'payroll',
    label: 'Payroll & Salary Sheets',
    actions: ['view', 'create', 'edit', 'delete', 'print'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete', print: 'Print' },
  },
  {
    module: 'advances',
    label: 'Worker Advances',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Add Advances', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'accounts',
    label: 'Account Research',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'vat',
    label: 'VAT Return Expense',
    // 'view' is a baseline permission — every signed-in user can view VAT bills
    // (see BASELINE_PERMISSIONS below); create/edit/delete stay role-gated.
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'roles',
    label: 'Roles',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'users',
    label: 'Users',
    actions: ['view', 'create', 'edit', 'delete'],
    actionLabels: { view: 'View', create: 'Create', edit: 'Edit', delete: 'Delete' },
  },
  {
    module: 'settings',
    label: 'Settings',
    actions: ['view', 'edit'],
    actionLabels: { view: 'View', edit: 'Edit' },
  },
  {
    module: 'activity',
    label: 'Activity Log',
    actions: ['view'],
    actionLabels: { view: 'View' },
  },
]

export const ALL_PERMISSIONS: string[] = MODULES.flatMap((m) =>
  m.actions.map((a) => `${m.module}.${a}`)
)

/**
 * Baseline permissions granted to EVERY signed-in user, regardless of role.
 * The VAT Return Expense module is visible company-wide: all users can see
 * bills and summaries, while create/edit/delete remain role-gated.
 * Enforced server-side (lib/auth.ts hasPermission) and client-side (lib/store.ts can).
 */
export const BASELINE_PERMISSIONS: ReadonlySet<string> = new Set(['vat.view'])

export function isValidPermission(p: string): boolean {
  return p === '*' || ALL_PERMISSIONS.includes(p)
}
