import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { SOURCE_OPTIONS, LEAD_TEMPERATURE_OPTIONS, TRADING_EXPERIENCE_OPTIONS } from '../lib/constants'
import SearchableSelect from './SearchableSelect'
import './LeadFormModal.css'

export default function EditLeadModal({ lead, onClose, onSaved }) {
  const [products, setProducts] = useState([])
  const [form, setForm] = useState({
    lead_name: lead.lead_name || '',
    client_name: lead.client_name || '',
    mobile: lead.mobile || '',
    email: lead.email || '',
    company: lead.company || '',
    industry_type: lead.industry_type || '',
    city: lead.city || '',
    state: lead.state || '',
    product_id: lead.product_id || '',
    source: lead.source || 'manual_entry',
    requirement: lead.requirement || '',
    lead_temperature: lead.lead_temperature || '',
    priority: lead.priority || 'medium',
    budget: lead.budget || '',
    expected_deal_value: lead.expected_deal_value || '',
    closing_tat: lead.closing_tat || ''
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
    setSaving(true)

    const { error: updateError } = await supabase
      .from('leads')
      .update({
        lead_name: form.lead_name.trim(),
        mobile: form.mobile.trim() || null,
        email: form.email.trim() || null,
        company: form.company.trim() || form.lead_name.trim(),
        industry_type: form.industry_type.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        product_id: form.product_id || null,
        // Never send an empty string — lead_source is a Postgres enum and
        // rejects "" outright. Falls back to Manual if the field is ever
        // somehow left blank (e.g. an old lead saved before this column
        // was populated).
        source: form.source || 'manual_entry',
        requirement: form.requirement.trim() || null,
        lead_temperature: form.lead_temperature || null
      })
      .eq('id', lead.id)

    setSaving(false)

    if (updateError) {
      setError(updateError.message)
      return
    }

    onSaved()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card lead-form-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Lead</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit}>
          <h3 className="form-section-title">Student Details</h3>
          <div className="modal-grid">
            <div className="field">
              <label>Student Name *</label>
              <input className="text-input" value={form.lead_name} onChange={(e) => update('lead_name', e.target.value)} />
            </div>
            <div className="field">
              <label>Mobile No. *</label>
              <input className="text-input" value={form.mobile} onChange={(e) => update('mobile', e.target.value)} />
            </div>
            <div className="field">
              <label>Email</label>
              <input className="text-input" type="email" value={form.email} onChange={(e) => update('email', e.target.value)} />
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
              <input className="text-input" value={form.city} onChange={(e) => update('city', e.target.value)} />
            </div>
            <div className="field">
              <label>State</label>
              <input className="text-input" value={form.state} onChange={(e) => update('state', e.target.value)} />
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
              <textarea className="text-input" rows={2} value={form.requirement} onChange={(e) => update('requirement', e.target.value)} />
            </div>
          </div>

          <h3 className="form-section-title">Priority</h3>
          <div className="modal-grid">
            <div className="field">
              <label>Priority</label>
              <select className="text-input" value={form.lead_temperature} onChange={(e) => update('lead_temperature', e.target.value)}>
                <option value="">-- Select --</option>
                {LEAD_TEMPERATURE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                ))}
              </select>
            </div>




          </div>

          {error && <div className="form-error" role="alert">{error}</div>}

          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
