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
 *   generate – Create NEW documents in `collection` from records of `from`.
 *            The source collection is read-only. Existing or duplicate
 *            destination ids abort the migration; generated documents are
 *            erased on rollback via the snapshot (down.generate is not supported).
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
    /**
     * Optional: create new documents in `collection` from records of `from`
     * (read-only). Runs before add/remove/update, so those ops also apply to
     * the generated documents.
     */
    // generate: {
    //   from: 'source_collection',
    //   where: [['active', '==', true]], // optional server-side filter
    //   id: (doc, { id, index }) => `generated_${id}_${index}`, // optional, deterministic
    //   create: (doc, { id }) => ({ sourceId: id, name: doc.name }), // object | array | null
    // },
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
   * Note: generated documents are only erased from the snapshot — a
   * `down.generate` block is not supported.
   */
  down: {
    add: {},
    remove: [],
    update: {},
  },
};
