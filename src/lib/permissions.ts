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

export function isValidPermission(p: string): boolean {
  return p === '*' || ALL_PERMISSIONS.includes(p)
}
