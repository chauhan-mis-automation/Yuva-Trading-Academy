import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { STATUS_OPTIONS, SOURCE_OPTIONS, LEAD_TEMPERATURE_OPTIONS, ACTION_TYPE_OPTIONS, TRADING_EXPERIENCE_OPTIONS } from '../lib/constants'
import SearchableSelect from './SearchableSelect'
import './LeadFormModal.css'

export default function LeadFormModal({ users, currentUserId, onClose, onSaved }) {
  const [products, setProducts] = useState([])
  const [form, setForm] = useState({
    lead_name: '',
    client_name: '',
    mobile: '',
    email: '',
    company: '',
    industry_type: '',
    city: '',
    state: '',
    source: 'manual_entry',
    product_id: '',
    requirement: '',
    status: 'new_lead',
    lead_temperature: '',
    priority: 'medium',
    // Managers (who see the "Assign To" dropdown, i.e. `users` is non-empty)
    // default to unassigned so they consciously pick someone. Sales/BDE, who
    // don't get the dropdown, self-assign automatically.
    assigned_to: users.length === 0 ? (currentUserId || '') : '',
    budget: '',
    expected_deal_value: '',
    closing_tat: '',
    next_followup_date: '',
    next_action_type: 'call',
    next_action: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadProducts() {
      const { data } = await supabase.from('products').select('id, product_name, category').eq('is_active', true).order('product_name')
      setProducts(data || [])
    }
    loadProducts()
  }, [])

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.lead_name.trim()) {
      setError('Student name is required.')
      return
    }
    if (!form.mobile.trim()) {
      setError('Mobile no. is required.')
      return
    }
    setError('')

    // Duplicate check — warn if this mobile number is already in the CRM,
    // but still let the user proceed if they confirm (e.g. genuinely two
    // different leads sharing a number, like a shared office phone).
    const { data: existing } = await supabase
      .from('leads')
      .select('id, lead_name, company, status')
      .eq('mobile', form.mobile.trim())
      .limit(1)
      .maybeSingle()

    if (existing) {
      const proceed = window.confirm(
        `A lead with this mobile number already exists: "${existing.lead_name}"${existing.company ? ` (${existing.company})` : ''}, status: ${existing.status}.\n\nAdd this as a new lead anyway?`
      )
      if (!proceed) return
    }

    setSaving(true)

    const payload = {
      lead_name: form.lead_name.trim(),
      client_name: null,
      mobile: form.mobile.trim() || null,
      email: form.email.trim() || null,
      company: form.lead_name.trim(),
      industry_type: form.industry_type.trim() || null,
      city: form.city.trim() || null,
      state: form.state.trim() || null,
      // Never send an empty string — lead_source is a Postgres enum and
      // rejects "" outright. Falls back to Manual if the field is ever
      // somehow left blank.
      source: form.source || 'manual_entry',
      product_id: form.product_id || null,
      requirement: form.requirement.trim() || null,
      status: form.status,
      lead_temperature: form.lead_temperature || null,
      assigned_to: form.assigned_to || null,
      next_followup_date: form.next_followup_date ? new Date(form.next_followup_date).toISOString() : null,
      next_action_type: form.next_action_type || 'call',
      next_action: form.next_action.trim() || null,
      created_by: currentUserId
    }

    const { error: insertError } = await supabase.from('leads').insert(payload)

    setSaving(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card lead-form-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Add New Lead</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <h3 className="form-section-title">Student Details</h3>
          <div className="modal-grid">
            <div className="field">
              <label>Student Name *</label>
              <input
                className="text-input"
                value={form.lead_name}
                onChange={(e) => update('lead_name', e.target.value)}
                placeholder="Student's name"
              />
            </div>


            <div className="field">
              <label>Mobile No. *</label>
              <input
                className="text-input"
                value={form.mobile}
                onChange={(e) => update('mobile', e.target.value)}
                placeholder="10-digit number"
              />
            </div>

            <div className="field">
              <label>Email</label>
              <input
                className="text-input"
                type="email"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                placeholder="email@example.com"
              />
            </div>


            <div className="field">
              <label>Trading Experience</label>
              <select className="text-input" value={form.industry_type} onChange={(e) => update('industry_type', e.target.value)}>
                <option value="">-- Select --</option>
                {TRADING_EXPERIENCE_OPTIONS.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>City</label>
              <input
                className="text-input"
                value={form.city}
                onChange={(e) => update('city', e.target.value)}
                placeholder="City"
              />
            </div>

            <div className="field">
              <label>State</label>
              <input
                className="text-input"
                value={form.state}
                onChange={(e) => update('state', e.target.value)}
                placeholder="State"
              />
            </div>

            <div className="field">
              <label>Source</label>
              <select className="text-input" value={form.source} onChange={(e) => update('source', e.target.value)}>
                {SOURCE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Interested Course</label>
              <SearchableSelect
                options={products.map((p) => ({ value: p.id, label: p.product_name, sublabel: p.category }))}
                value={form.product_id}
                onChange={(v) => update('product_id', v)}
                placeholder="Search course…"
                emptyLabel="-- None --"
              />
            </div>

            <div className="field wide">
              <label>Preferred Course / Notes</label>
              <textarea
                className="text-input"
                rows={2}
                value={form.requirement}
                onChange={(e) => update('requirement', e.target.value)}
                placeholder="Which course / batch does the student prefer?"
              />
            </div>
          </div>

          <h3 className="form-section-title">Status &amp; Counsellor</h3>
          <div className="modal-grid">
            <div className="field">
              <label>Status</label>
              <select className="text-input" value={form.status} onChange={(e) => update('status', e.target.value)}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Priority</label>
              <select className="text-input" value={form.lead_temperature} onChange={(e) => update('lead_temperature', e.target.value)}>
                <option value="">-- Select --</option>
                {LEAD_TEMPERATURE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>


            <div className="field">
              <label>Assigned Counsellor</label>
              {users.length > 0 ? (
                <select className="text-input" value={form.assigned_to} onChange={(e) => update('assigned_to', e.target.value)}>
                  <option value="">-- Unassigned --</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>
                  ))}
                </select>
              ) : (
                <p className="static-value">Assigned to: You</p>
              )}
            </div>



          </div>

          <h3 className="form-section-title">Follow-up</h3>
          <div className="modal-grid">
            <div className="field">
              <label>Next Follow-up Date &amp; Time</label>
              <input className="text-input" type="datetime-local" value={form.next_followup_date} onChange={(e) => update('next_followup_date', e.target.value)} />
            </div>
            <div className="field">
              <label>Follow-up Mode</label>
              <select className="text-input" value={form.next_action_type} onChange={(e) => update('next_action_type', e.target.value)}>
                {ACTION_TYPE_OPTIONS.map((a) => (
                  <option key={a.value} value={a.value}>{a.icon} {a.label}</option>
                ))}
              </select>
            </div>
            <div className="field wide">
              <label>Next Action</label>
              <input className="text-input" value={form.next_action} onChange={(e) => update('next_action', e.target.value)} placeholder="e.g. Send course brochure, demo class invite" />
            </div>
          </div>

          {error && <div className="form-error" role="alert">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
