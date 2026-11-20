/**
 * Global configuration, permission levels, function registry and sheet schema.
 * Loaded first. Apps Script shares one global scope across all files in the
 * project, so every top-level name here is deliberately unique.
 */

var CFG = {
  SESSION_HOURS: 8,
  LOGIN_MAX_FAILURES: 5,
  LOGIN_LOCK_MINUTES: 15,
  LOCK_WAIT_MS: 10000,
  IDEMPOTENCY_TTL_SECONDS: 21600,
  RATE_LIMIT_PER_MINUTE: 120,
  PASSWORD_ROUNDS: 2000,
  PAGE_SIZE_DEFAULT: 50,
  PAGE_SIZE_MAX: 200,
  MIN_PASSWORD_LENGTH: 12,
  CURRENCY_DEFAULT: 'USD'
};

var LEVELS = ['View', 'Create', 'Edit', 'Delete', 'Approve', 'Execute', 'Export', 'Full Access'];

/**
 * Spreadsheet domains. Script Properties hold the real spreadsheet IDs under
 * these keys (set by Setup.initialize). No ID is written into code.
 */
var DOMAIN_PROP = {
  DB_CORE: 'PMS_DB_CORE_ID',
  DB_ROOMS: 'PMS_DB_ROOMS_ID',
  DB_RESERVATIONS: 'PMS_DB_RESERVATIONS_ID',
  DB_FOLIOS: 'PMS_DB_FOLIOS_ID',
  DB_FINANCE: 'PMS_DB_FINANCE_ID'
};

/**
 * Sheet schema. `key` is the permanent identifier column. Row numbers are never
 * used as identifiers. `append_only` sheets accept inserts only.
 */
var SCHEMA = {
  Organizations: {
    domain: 'DB_CORE', key: 'org_id',
    headers: ['org_id', 'name', 'status', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Properties: {
    domain: 'DB_CORE', key: 'property_id',
    headers: ['property_id', 'org_id', 'code', 'name', 'status', 'currency', 'timezone', 'business_date',
      'license_rooms', 'user_limit', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Users: {
    domain: 'DB_CORE', key: 'user_id',
    headers: ['user_id', 'org_id', 'username', 'display_name', 'email', 'password_hash', 'salt', 'status', 'role_ids',
      'property_ids', 'must_change_password', 'password_changed_at', 'failed_logins', 'locked_until',
      'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Email_Settings: {
    domain: 'DB_CORE', key: 'setting_id',
    headers: ['setting_id', 'smtp_active', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_password_enc',
      'relay_url', 'relay_secret_enc', 'resend_active', 'resend_api_key_enc', 'resend_key_hint',
      'from_name', 'from_email', 'app_url', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Roles: {
    domain: 'DB_CORE', key: 'role_id',
    headers: ['role_id', 'org_id', 'name', 'is_system', 'approval_limit_minor', 'created_at', 'created_by',
      'updated_at', 'updated_by', 'version']
  },
  Permissions: {
    domain: 'DB_CORE', key: 'perm_id',
    headers: ['perm_id', 'role_id', 'function_id', 'levels', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Feature_Flags: {
    domain: 'DB_CORE', key: 'flag_id',
    headers: ['flag_id', 'property_id', 'module_key', 'enabled', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Sessions: {
    domain: 'DB_CORE', key: 'session_id', append_only: true,
    headers: ['session_id', 'token_hash', 'user_id', 'created_at', 'expires_at', 'revoked']
  },
  Audit_Log: {
    domain: 'DB_CORE', key: 'audit_id', append_only: true,
    headers: ['audit_id', 'at', 'user_id', 'property_id', 'function_id', 'action', 'entity', 'entity_id',
      'before_json', 'after_json']
  },
  Config_Items: {
    domain: 'DB_CORE', key: 'config_id',
    headers: ['config_id', 'property_id', 'config_type', 'code', 'description', 'data_json', 'active',
      'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Room_Types: {
    domain: 'DB_ROOMS', key: 'room_type_id',
    headers: ['room_type_id', 'property_id', 'code', 'description', 'max_occupancy', 'base_rate_minor', 'active',
      'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Rooms: {
    domain: 'DB_ROOMS', key: 'room_id',
    headers: ['room_id', 'property_id', 'room_number', 'room_type_id', 'floor', 'status', 'housekeeping_status',
      'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Guest_Profiles: {
    domain: 'DB_RESERVATIONS', key: 'guest_id',
    headers: ['guest_id', 'org_id', 'first_name', 'last_name', 'email', 'phone', 'nationality',
      'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Reservations: {
    domain: 'DB_RESERVATIONS', key: 'res_id',
    headers: ['res_id', 'property_id', 'confirmation_no', 'guest_id', 'room_type_id', 'room_id', 'arrival',
      'departure', 'status', 'rate_code', 'rate_minor', 'currency', 'market_code', 'source_code', 'adults',
      'children', 'folio_id', 'cancel_reason', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Folios: {
    domain: 'DB_FOLIOS', key: 'folio_id',
    headers: ['folio_id', 'property_id', 'res_id', 'folio_no', 'status', 'currency', 'created_at', 'created_by',
      'updated_at', 'updated_by', 'version']
  },
  Transactions: {
    domain: 'DB_FOLIOS', key: 'txn_id', append_only: true,
    headers: ['txn_id', 'txn_key', 'property_id', 'folio_id', 'res_id', 'code', 'kind', 'amount_minor', 'currency',
      'business_date', 'reverses_txn_id', 'description', 'created_at', 'created_by']
  },
  Night_Audit_Runs: {
    domain: 'DB_FINANCE', key: 'run_id',
    headers: ['run_id', 'property_id', 'business_date', 'status', 'started_at', 'completed_at', 'rooms_posted',
      'room_minor', 'tax_minor', 'no_shows', 'error', 'created_by']
  },
  Approval_Requests: {
    domain: 'DB_FOLIOS', key: 'approval_id',
    headers: ['approval_id', 'property_id', 'folio_id', 'res_id', 'code', 'kind', 'amount_minor', 'currency',
      'business_date', 'description', 'status', 'requested_by', 'requested_at', 'decided_by', 'decided_at',
      'decision_note', 'txn_id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Maintenance_Requests: {
    domain: 'DB_ROOMS', key: 'request_id',
    headers: ['request_id', 'property_id', 'room_id', 'category', 'priority', 'description', 'status', 'assigned_to',
      'resolution', 'completed_at', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Housekeeping_Tasks: {
    domain: 'DB_ROOMS', key: 'task_id',
    headers: ['task_id', 'property_id', 'room_id', 'business_date', 'task_type', 'assigned_to', 'status',
      'completed_at', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  },
  Lost_Found: {
    domain: 'DB_ROOMS', key: 'item_id',
    headers: ['item_id', 'property_id', 'description', 'location', 'found_on', 'status', 'claimed_by', 'claimed_at',
      'notes', 'created_at', 'created_by', 'updated_at', 'updated_by', 'version']
  }
};

/** Modules that can be switched on or off per property. */
var MODULES = ['CONFIG', 'RESERVATIONS', 'FRONT_OFFICE', 'CASHIERING', 'NIGHT_AUDIT', 'REPORTING',
  'ENGINEERING', 'HOUSEKEEPING'];

/**
 * Function registry. Every API action is bound to one of these IDs. The
 * Permissions sheet grants levels per role per function ID.
 */
var FUNCTIONS = {
  'ADMIN.ORG':       { module: null, label: 'Organizations' },
  'ADMIN.PROPERTY':  { module: null, label: 'Properties and licensing' },
  'ADMIN.USER':      { module: null, label: 'Users' },
  'ADMIN.ROLE':      { module: null, label: 'Roles and approval limits' },
  'ADMIN.PERM':      { module: null, label: 'Permission matrix' },
  'ADMIN.FLAG':      { module: null, label: 'Feature flags' },
  'ADMIN.AUDIT':     { module: null, label: 'Audit log' },
  'ADMIN.EMAIL':     { module: null, label: 'Email configuration' },
  'CFG.ROOMTYPE':    { module: 'CONFIG', label: 'Room types' },
  'CFG.ROOM':        { module: 'CONFIG', label: 'Rooms' },
  'CFG.CODE':        { module: 'CONFIG', label: 'Rate, transaction, market, source, package and payment codes' },
  'CFG.TAX':         { module: 'CONFIG', label: 'Tax rules' },
  'RES.BOOK':        { module: 'RESERVATIONS', label: 'Create reservations' },
  'RES.VIEW':        { module: 'RESERVATIONS', label: 'View reservations' },
  'RES.MODIFY':      { module: 'RESERVATIONS', label: 'Modify reservations' },
  'RES.CANCEL':      { module: 'RESERVATIONS', label: 'Cancel and no-show' },
  'FO.RACK':         { module: 'FRONT_OFFICE', label: 'Room rack and arrivals' },
  'FO.CHECKIN':      { module: 'FRONT_OFFICE', label: 'Check-in' },
  'FO.CHECKOUT':     { module: 'FRONT_OFFICE', label: 'Check-out' },
  'FO.HOUSEKEEPING': { module: 'FRONT_OFFICE', label: 'Room status and housekeeping' },
  'CASH.VIEW':       { module: 'CASHIERING', label: 'View folios' },
  'CASH.POST':       { module: 'CASHIERING', label: 'Post charges and payments' },
  'CASH.TRANSFER':   { module: 'CASHIERING', label: 'Transfer between folios' },
  'CASH.REVERSE':    { module: 'CASHIERING', label: 'Reverse transactions' },
  'CASH.ADJUST':     { module: 'CASHIERING', label: 'Rebates and adjustments' },
  'APPROVAL.QUEUE':  { module: 'CASHIERING', label: 'Posting approvals' },
  'ENG.REQUEST':     { module: 'ENGINEERING', label: 'Maintenance requests' },
  'HK.TASKS':        { module: 'HOUSEKEEPING', label: 'Housekeeping tasks' },
  'HK.LOST':         { module: 'HOUSEKEEPING', label: 'Lost and found' },
  'AUDIT.RUN':       { module: 'NIGHT_AUDIT', label: 'Night audit' },
  'RPT.VIEW':        { module: 'REPORTING', label: 'Reports' }
};

/** Transaction kinds and their sign convention. Positive increases a folio balance. */
var TXN_KINDS = {
  CHARGE: { sign: 1 },
  PAYMENT: { sign: -1 },
  ADJUSTMENT: { sign: 1 },
  REBATE: { sign: -1 },
  TRANSFER: { sign: 1 },
  REVERSAL: { sign: 1 }
};

/** Config item types stored in Config_Items. */
var CONFIG_TYPES = ['RATE_CODE', 'TRANSACTION_CODE', 'MARKET_CODE', 'SOURCE_CODE', 'PACKAGE_CODE',
  'PAYMENT_METHOD', 'TAX_RULE'];
