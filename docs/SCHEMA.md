# Sheet schema

Generated from `apps-script/src/00_config.js`. Do not edit by hand.

## Organizations

- Spreadsheet domain: `DB_CORE`
- Key column: `org_id`
- Append only: no

| Column |
| --- |
| `org_id` |
| `name` |
| `status` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Properties

- Spreadsheet domain: `DB_CORE`
- Key column: `property_id`
- Append only: no

| Column |
| --- |
| `property_id` |
| `org_id` |
| `code` |
| `name` |
| `status` |
| `currency` |
| `timezone` |
| `business_date` |
| `license_rooms` |
| `user_limit` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Users

- Spreadsheet domain: `DB_CORE`
- Key column: `user_id`
- Append only: no

| Column |
| --- |
| `user_id` |
| `org_id` |
| `username` |
| `display_name` |
| `password_hash` |
| `salt` |
| `status` |
| `role_ids` |
| `property_ids` |
| `failed_logins` |
| `locked_until` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Roles

- Spreadsheet domain: `DB_CORE`
- Key column: `role_id`
- Append only: no

| Column |
| --- |
| `role_id` |
| `org_id` |
| `name` |
| `is_system` |
| `approval_limit_minor` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Permissions

- Spreadsheet domain: `DB_CORE`
- Key column: `perm_id`
- Append only: no

| Column |
| --- |
| `perm_id` |
| `role_id` |
| `function_id` |
| `levels` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Feature_Flags

- Spreadsheet domain: `DB_CORE`
- Key column: `flag_id`
- Append only: no

| Column |
| --- |
| `flag_id` |
| `property_id` |
| `module_key` |
| `enabled` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Sessions

- Spreadsheet domain: `DB_CORE`
- Key column: `session_id`
- Append only: yes

| Column |
| --- |
| `session_id` |
| `token_hash` |
| `user_id` |
| `created_at` |
| `expires_at` |
| `revoked` |

## Audit_Log

- Spreadsheet domain: `DB_CORE`
- Key column: `audit_id`
- Append only: yes

| Column |
| --- |
| `audit_id` |
| `at` |
| `user_id` |
| `property_id` |
| `function_id` |
| `action` |
| `entity` |
| `entity_id` |
| `before_json` |
| `after_json` |

## Config_Items

- Spreadsheet domain: `DB_CORE`
- Key column: `config_id`
- Append only: no

| Column |
| --- |
| `config_id` |
| `property_id` |
| `config_type` |
| `code` |
| `description` |
| `data_json` |
| `active` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Room_Types

- Spreadsheet domain: `DB_ROOMS`
- Key column: `room_type_id`
- Append only: no

| Column |
| --- |
| `room_type_id` |
| `property_id` |
| `code` |
| `description` |
| `max_occupancy` |
| `base_rate_minor` |
| `active` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Rooms

- Spreadsheet domain: `DB_ROOMS`
- Key column: `room_id`
- Append only: no

| Column |
| --- |
| `room_id` |
| `property_id` |
| `room_number` |
| `room_type_id` |
| `floor` |
| `status` |
| `housekeeping_status` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Guest_Profiles

- Spreadsheet domain: `DB_RESERVATIONS`
- Key column: `guest_id`
- Append only: no

| Column |
| --- |
| `guest_id` |
| `org_id` |
| `first_name` |
| `last_name` |
| `email` |
| `phone` |
| `nationality` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Reservations

- Spreadsheet domain: `DB_RESERVATIONS`
- Key column: `res_id`
- Append only: no

| Column |
| --- |
| `res_id` |
| `property_id` |
| `confirmation_no` |
| `guest_id` |
| `room_type_id` |
| `room_id` |
| `arrival` |
| `departure` |
| `status` |
| `rate_code` |
| `rate_minor` |
| `currency` |
| `market_code` |
| `source_code` |
| `adults` |
| `children` |
| `folio_id` |
| `cancel_reason` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Folios

- Spreadsheet domain: `DB_FOLIOS`
- Key column: `folio_id`
- Append only: no

| Column |
| --- |
| `folio_id` |
| `property_id` |
| `res_id` |
| `folio_no` |
| `status` |
| `currency` |
| `created_at` |
| `created_by` |
| `updated_at` |
| `updated_by` |
| `version` |

## Transactions

- Spreadsheet domain: `DB_FOLIOS`
- Key column: `txn_id`
- Append only: yes

| Column |
| --- |
| `txn_id` |
| `txn_key` |
| `property_id` |
| `folio_id` |
| `res_id` |
| `code` |
| `kind` |
| `amount_minor` |
| `currency` |
| `business_date` |
| `reverses_txn_id` |
| `description` |
| `created_at` |
| `created_by` |

## Night_Audit_Runs

- Spreadsheet domain: `DB_FINANCE`
- Key column: `run_id`
- Append only: no

| Column |
| --- |
| `run_id` |
| `property_id` |
| `business_date` |
| `status` |
| `started_at` |
| `completed_at` |
| `rooms_posted` |
| `room_minor` |
| `tax_minor` |
| `no_shows` |
| `error` |
| `created_by` |
