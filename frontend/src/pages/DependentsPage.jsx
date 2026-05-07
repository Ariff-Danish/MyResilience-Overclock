/**
 * DependentsPage — Family member and dependent management.
 *
 * Features:
 * - List all dependents with priority ordering
 * - Add/edit/delete dependents
 * - Medical conditions, medications, mobility tracking
 * - Age group and dietary restrictions
 */
import { useState, useEffect } from 'react'
import api from '../lib/api'

const RELATIONSHIPS = [
  'spouse', 'child', 'parent', 'sibling', 'grandparent',
  'grandchild', 'relative', 'caregiver', 'other',
]
const AGE_GROUPS = ['infant', 'toddler', 'child', 'teen', 'adult', 'elderly']
const MOBILITY_LEVELS = ['full', 'limited', 'wheelchair', 'bedridden']

const RELATIONSHIP_EMOJI = {
  spouse: '💑', child: '👶', parent: '👨‍👩‍👦', sibling: '👫',
  grandparent: '👴', grandchild: '🧒', relative: '👪',
  caregiver: '🧑‍⚕️', other: '👤',
}

const STYLES = {
  container: {
    minHeight: '100vh',
    background: '#0a0a0f',
    color: '#e2e8f0',
    fontFamily: 'Inter, system-ui, sans-serif',
    padding: '24px 20px',
    maxWidth: 900,
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
    paddingBottom: 16,
    borderBottom: '1px solid rgba(100, 116, 139, 0.2)',
  },
  title: { fontSize: 24, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 },
  backButton: {
    background: 'rgba(100, 116, 139, 0.2)',
    border: '1px solid rgba(100, 116, 139, 0.3)',
    borderRadius: 8,
    color: '#94a3b8',
    padding: '8px 16px',
    fontSize: 13,
    cursor: 'pointer',
    textDecoration: 'none',
  },
  card: {
    background: 'rgba(15, 15, 25, 0.8)',
    border: '1px solid rgba(100, 116, 139, 0.15)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
    transition: 'border-color 0.2s',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardName: { fontSize: 16, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 },
  cardMeta: { fontSize: 13, color: '#64748b', display: 'flex', gap: 16, flexWrap: 'wrap' },
  tag: (color = 'rgba(139, 92, 246, 0.2)') => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 500,
    background: color,
    color: '#e2e8f0',
  }),
  button: {
    padding: '10px 20px',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    transition: 'all 0.2s',
  },
  primaryButton: { background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', color: '#fff' },
  dangerButton: {
    background: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    color: '#fca5a5',
    padding: '6px 12px',
    fontSize: 12,
  },
  editButton: {
    background: 'rgba(139, 92, 246, 0.15)',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    color: '#c4b5fd',
    padding: '6px 12px',
    fontSize: 12,
  },
  modal: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: 20,
  },
  modalContent: {
    background: '#0f0f19',
    border: '1px solid rgba(139, 92, 246, 0.3)',
    borderRadius: 16,
    padding: 28,
    width: '100%',
    maxWidth: 520,
    maxHeight: '85vh',
    overflowY: 'auto',
  },
  modalTitle: { fontSize: 18, fontWeight: 600, marginBottom: 20, color: '#c4b5fd' },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 },
  label: { fontSize: 13, fontWeight: 500, color: '#94a3b8' },
  input: {
    padding: '10px 12px',
    background: 'rgba(30, 30, 50, 0.8)',
    border: '1px solid rgba(100, 116, 139, 0.3)',
    borderRadius: 8,
    color: '#e2e8f0',
    fontSize: 14,
    outline: 'none',
  },
  select: {
    padding: '10px 12px',
    background: 'rgba(30, 30, 50, 0.8)',
    border: '1px solid rgba(100, 116, 139, 0.3)',
    borderRadius: 8,
    color: '#e2e8f0',
    fontSize: 14,
    outline: 'none',
  },
  textarea: {
    padding: '10px 12px',
    background: 'rgba(30, 30, 50, 0.8)',
    border: '1px solid rgba(100, 116, 139, 0.3)',
    borderRadius: 8,
    color: '#e2e8f0',
    fontSize: 14,
    outline: 'none',
    minHeight: 60,
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  buttonRow: { display: 'flex', gap: 12, marginTop: 16, justifyContent: 'flex-end' },
  empty: {
    textAlign: 'center',
    padding: '48px 20px',
    color: '#64748b',
  },
  emptyEmoji: { fontSize: 48, marginBottom: 12 },
  message: (type) => ({
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 16,
    background: type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
    border: `1px solid ${type === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
    color: type === 'error' ? '#fca5a5' : '#86efac',
  }),
  chipContainer: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '3px 10px',
    borderRadius: 12,
    fontSize: 12,
    background: 'rgba(139, 92, 246, 0.15)',
    color: '#c4b5fd',
  },
  chipRemove: {
    background: 'none',
    border: 'none',
    color: '#f87171',
    cursor: 'pointer',
    fontSize: 14,
    padding: 0,
    lineHeight: 1,
  },
}

const EMPTY_FORM = {
  full_name: '',
  relationship: 'child',
  age: '',
  age_group: 'adult',
  medical_conditions: [],
  medications: [],
  mobility_level: 'full',
  dietary_restrictions: [],
  priority: 1,
  notes: '',
}

function DependentForm({ initial, onSave, onCancel, saving }) {
  const [form, setForm] = useState(initial || EMPTY_FORM)
  const [newCondition, setNewCondition] = useState('')
  const [newMedication, setNewMedication] = useState('')
  const [newDiet, setNewDiet] = useState('')

  const addToList = (field, value, setter) => {
    if (!value.trim()) return
    setForm(prev => ({ ...prev, [field]: [...prev[field], value.trim()] }))
    setter('')
  }

  const removeFromList = (field, index) => {
    setForm(prev => ({ ...prev, [field]: prev[field].filter((_, i) => i !== index) }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave({
      ...form,
      age: form.age ? parseInt(form.age) : null,
    })
  }

  return (
    <div style={STYLES.modal} onClick={onCancel}>
      <div style={STYLES.modalContent} onClick={(e) => e.stopPropagation()}>
        <h3 style={STYLES.modalTitle}>
          {initial ? '✏️ Edit Dependent' : '➕ Add Dependent'}
        </h3>
        <form onSubmit={handleSubmit}>
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Full Name *</label>
            <input
              style={STYLES.input}
              value={form.full_name}
              onChange={(e) => setForm(prev => ({ ...prev, full_name: e.target.value }))}
              required
              placeholder="Name"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={STYLES.fieldGroup}>
              <label style={STYLES.label}>Relationship *</label>
              <select
                style={STYLES.select}
                value={form.relationship}
                onChange={(e) => setForm(prev => ({ ...prev, relationship: e.target.value }))}
              >
                {RELATIONSHIPS.map(r => (
                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </div>
            <div style={STYLES.fieldGroup}>
              <label style={STYLES.label}>Age</label>
              <input
                style={STYLES.input}
                type="number"
                min="0"
                max="150"
                value={form.age}
                onChange={(e) => setForm(prev => ({ ...prev, age: e.target.value }))}
                placeholder="Age"
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={STYLES.fieldGroup}>
              <label style={STYLES.label}>Age Group</label>
              <select
                style={STYLES.select}
                value={form.age_group}
                onChange={(e) => setForm(prev => ({ ...prev, age_group: e.target.value }))}
              >
                {AGE_GROUPS.map(g => (
                  <option key={g} value={g}>{g.charAt(0).toUpperCase() + g.slice(1)}</option>
                ))}
              </select>
            </div>
            <div style={STYLES.fieldGroup}>
              <label style={STYLES.label}>Mobility</label>
              <select
                style={STYLES.select}
                value={form.mobility_level}
                onChange={(e) => setForm(prev => ({ ...prev, mobility_level: e.target.value }))}
              >
                {MOBILITY_LEVELS.map(m => (
                  <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Priority (1 = highest)</label>
            <input
              style={STYLES.input}
              type="number"
              min="1"
              max="10"
              value={form.priority}
              onChange={(e) => setForm(prev => ({ ...prev, priority: parseInt(e.target.value) || 1 }))}
            />
          </div>

          {/* Medical Conditions */}
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Medical Conditions</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...STYLES.input, flex: 1 }}
                value={newCondition}
                onChange={(e) => setNewCondition(e.target.value)}
                placeholder="Add condition..."
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addToList('medical_conditions', newCondition, setNewCondition) } }}
              />
              <button
                type="button"
                style={{ ...STYLES.button, ...STYLES.primaryButton, padding: '8px 14px', fontSize: 13 }}
                onClick={() => addToList('medical_conditions', newCondition, setNewCondition)}
              >+</button>
            </div>
            <div style={STYLES.chipContainer}>
              {form.medical_conditions.map((c, i) => (
                <span key={i} style={STYLES.chip}>
                  {c}
                  <button type="button" style={STYLES.chipRemove} onClick={() => removeFromList('medical_conditions', i)}>×</button>
                </span>
              ))}
            </div>
          </div>

          {/* Medications */}
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Medications</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...STYLES.input, flex: 1 }}
                value={newMedication}
                onChange={(e) => setNewMedication(e.target.value)}
                placeholder="Add medication..."
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addToList('medications', newMedication, setNewMedication) } }}
              />
              <button
                type="button"
                style={{ ...STYLES.button, ...STYLES.primaryButton, padding: '8px 14px', fontSize: 13 }}
                onClick={() => addToList('medications', newMedication, setNewMedication)}
              >+</button>
            </div>
            <div style={STYLES.chipContainer}>
              {form.medications.map((m, i) => (
                <span key={i} style={STYLES.chip}>
                  {m}
                  <button type="button" style={STYLES.chipRemove} onClick={() => removeFromList('medications', i)}>×</button>
                </span>
              ))}
            </div>
          </div>

          {/* Dietary Restrictions */}
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Dietary Restrictions</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                style={{ ...STYLES.input, flex: 1 }}
                value={newDiet}
                onChange={(e) => setNewDiet(e.target.value)}
                placeholder="Add restriction..."
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addToList('dietary_restrictions', newDiet, setNewDiet) } }}
              />
              <button
                type="button"
                style={{ ...STYLES.button, ...STYLES.primaryButton, padding: '8px 14px', fontSize: 13 }}
                onClick={() => addToList('dietary_restrictions', newDiet, setNewDiet)}
              >+</button>
            </div>
            <div style={STYLES.chipContainer}>
              {form.dietary_restrictions.map((d, i) => (
                <span key={i} style={STYLES.chip}>
                  {d}
                  <button type="button" style={STYLES.chipRemove} onClick={() => removeFromList('dietary_restrictions', i)}>×</button>
                </span>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Notes</label>
            <textarea
              style={STYLES.textarea}
              value={form.notes}
              onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="Any additional notes..."
              maxLength={1000}
            />
          </div>

          <div style={STYLES.buttonRow}>
            <button type="button" style={{ ...STYLES.button, ...STYLES.editButton }} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              style={{ ...STYLES.button, ...STYLES.primaryButton, opacity: saving ? 0.6 : 1 }}
              disabled={saving}
            >
              {saving ? '⏳ Saving...' : initial ? '💾 Update' : '➕ Add Dependent'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


export default function DependentsPage() {
  const [dependents, setDependents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loadDependents = async () => {
    try {
      const data = await api.get('/api/dependents')
      setDependents(data.dependents || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDependents() }, [])

  const handleSave = async (formData) => {
    setSaving(true)
    setError('')
    try {
      if (editing) {
        await api.put(`/api/dependents/${editing.id}`, formData)
        setSuccess('Dependent updated!')
      } else {
        await api.post('/api/dependents', formData)
        setSuccess('Dependent added!')
      }
      setShowForm(false)
      setEditing(null)
      await loadDependents()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`Remove ${name} from your dependents?`)) return
    try {
      await api.delete(`/api/dependents/${id}`)
      setSuccess('Dependent removed')
      await loadDependents()
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.message)
    }
  }

  if (loading) {
    return (
      <div style={{ ...STYLES.container, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#94a3b8' }}>Loading dependents...</p>
      </div>
    )
  }

  return (
    <div style={STYLES.container}>
      {/* Header */}
      <div style={STYLES.header}>
        <h1 style={STYLES.title}>👨‍👩‍👧‍👦 Family & Dependents</h1>
        <div style={{ display: 'flex', gap: 10 }}>
          <a href="/profile" style={STYLES.backButton}>← Profile</a>
          <button
            style={{ ...STYLES.button, ...STYLES.primaryButton, fontSize: 13, padding: '8px 16px' }}
            onClick={() => { setEditing(null); setShowForm(true) }}
          >
            ➕ Add Dependent
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && <div style={STYLES.message('error')}>⚠️ {error}</div>}
      {success && <div style={STYLES.message('success')}>✅ {success}</div>}

      {/* Info */}
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        Add family members and dependents to receive personalized evacuation plans and emergency recommendations.
        Medical conditions and mobility levels help agents prioritize assistance during disasters.
      </p>

      {/* Dependent Cards */}
      {dependents.length === 0 ? (
        <div style={STYLES.empty}>
          <div style={STYLES.emptyEmoji}>👨‍👩‍👧‍👦</div>
          <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>No dependents added yet</p>
          <p style={{ fontSize: 13 }}>Add your family members to get personalized disaster preparedness plans.</p>
        </div>
      ) : (
        dependents.map((dep) => (
          <div
            key={dep.id}
            style={STYLES.card}
            onMouseEnter={(e) => e.currentTarget.style.borderColor = 'rgba(139, 92, 246, 0.3)'}
            onMouseLeave={(e) => e.currentTarget.style.borderColor = 'rgba(100, 116, 139, 0.15)'}
          >
            <div style={STYLES.cardHeader}>
              <div style={STYLES.cardName}>
                <span>{RELATIONSHIP_EMOJI[dep.relationship] || '👤'}</span>
                <span>{dep.full_name}</span>
                <span style={STYLES.tag()}>
                  {dep.relationship}
                </span>
                {dep.mobility_level !== 'full' && (
                  <span style={STYLES.tag('rgba(245, 158, 11, 0.2)')}>
                    ♿ {dep.mobility_level}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={STYLES.editButton}
                  onClick={() => { setEditing(dep); setShowForm(true) }}
                >
                  ✏️ Edit
                </button>
                <button
                  style={STYLES.dangerButton}
                  onClick={() => handleDelete(dep.id, dep.full_name)}
                >
                  🗑️
                </button>
              </div>
            </div>

            <div style={STYLES.cardMeta}>
              {dep.age && <span>Age: {dep.age}</span>}
              {dep.age_group && <span>Group: {dep.age_group}</span>}
              <span>Priority: {dep.priority}</span>
            </div>

            {/* Medical conditions */}
            {dep.medical_conditions?.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>🏥 Conditions: </span>
                <div style={STYLES.chipContainer}>
                  {dep.medical_conditions.map((c, i) => (
                    <span key={i} style={STYLES.chip}>{c}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Medications */}
            {dep.medications?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>💊 Medications: </span>
                <div style={STYLES.chipContainer}>
                  {dep.medications.map((m, i) => (
                    <span key={i} style={STYLES.chip}>{m}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {dep.notes && (
              <p style={{ fontSize: 13, color: '#64748b', marginTop: 8, fontStyle: 'italic' }}>
                📝 {dep.notes}
              </p>
            )}
          </div>
        ))
      )}

      {/* Form Modal */}
      {showForm && (
        <DependentForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => { setShowForm(false); setEditing(null) }}
          saving={saving}
        />
      )}
    </div>
  )
}
