/**
 * Migration: {{NAME}}
 * Generated at: {{TIMESTAMP_ISO}}
 *
 * Define the target collection and the field operations to apply.
 *
 * Supported operations (up / down):
 *   add    – Add new fields.
 *            { default: value }  → static default
 *            { from: (doc) => value } → computed from current document data
 *   remove – Array of field names to delete from each document.
 *   update – Transform existing fields.
 *            fieldName: (doc) => newValue
 *
 * Example:
 *   add: {
 *     status: { default: 'active' },
 *     fullName: { from: (doc) => `${doc.firstName || ''} ${doc.lastName || ''}`.trim() },
 *   },
 *   remove: ['legacyFlag'],
 *   update: {
 *     email: (doc) => (doc.email || '').toLowerCase(),
 *   },
 */

export default {
  /** Unique id (matches filename without extension) */
  id: '{{ID}}',

  /** Human-readable description */
  description: '{{DESCRIPTION}}',

  /** Target Firestore collection */
  collection: '{{COLLECTION}}',

  /**
   * Operations applied when running `firestore-migrator migrate`
   */
  up: {
    add: {
      // exampleField: { default: null },
      // computedField: { from: (doc) => doc.existingField * 2 },
    },
    remove: [
      // 'oldField',
    ],
    update: {
      // existingField: (doc) => doc.existingField.toUpperCase(),
    },
  },

  /**
   * Operations applied when running `firestore-migrator rollback`
   * Should reverse the changes made by `up`.
   * If omitted, rollback of this migration will be refused.
   */
  down: {
    add: {},
    remove: [],
    update: {},
  },
};
