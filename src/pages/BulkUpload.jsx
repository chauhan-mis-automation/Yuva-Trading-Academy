import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { useAuth } from '../AuthContext'
import { supabase } from '../supabaseClient'
import { STATUS_OPTIONS, SOURCE_OPTIONS, LEAD_TEMPERATURE_OPTIONS, ACTION_TYPE_OPTIONS, TRADING_EXPERIENCE_OPTIONS, statusMeta } from '../lib/constants'
import { INDIA_STATES } from '../lib/indiaLocations'
import './BulkUpload.css'

const HEADER_ALIASES = {
  'student name': 'lead_name', 'lead name': 'lead_name', 'name': 'lead_name', 'leadname': 'lead_name', 'customer name': 'lead_name',
  'mobile': 'mobile', 'phone': 'mobile', 'mobile number': 'mobile', 'mobile no': 'mobile', 'mobile no.': 'mobile', 'contact': 'mobile', 'whatsapp': 'mobile',
  'email': 'email', 'email address': 'email',
  'trading experience': 'industry_type', 'experience': 'industry_type',
  'city': 'city',
  'state': 'state',
  'source': 'source', 'lead source': 'source',
  'status': 'status', 'lead status': 'status',
  'priority': 'lead_temperature', 'lead priority': 'lead_temperature', 'lead temperature': 'lead_temperature', 'temperature': 'lead_temperature',
  'preferred course / notes': 'requirement', 'preferred course': 'requirement', 'requirement': 'requirement', 'notes': 'requirement',
  'interested course': 'product', 'course': 'product', 'product': 'product', 'product/service': 'product', 'product name': 'product', 'service': 'product',
  'assigned counsellor': 'assigned_to', 'counsellor': 'assigned_to', 'assigned to': 'assigned_to', 'assigned user': 'assigned_to', 'assignee': 'assigned_to',
  'next follow-up': 'next_followup_date', 'next followup date': 'next_followup_date', 'next follow-up date': 'next_followup_date',
  'follow up date': 'next_followup_date', 'next follow up': 'next_followup_date', 'follow-up date & time': 'next_followup_date', 'next follow-up date & time': 'next_followup_date',
  'follow-up mode': 'next_action_type', 'followup mode': 'next_action_type', 'mode': 'next_action_type',
  'next action': 'next_action'
}

const VALID_STATUS_VALUES = STATUS_OPTIONS.map((s) => s.value)
const STATUS_LABEL_TO_VALUE = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.label.toLowerCase(), s.value]))
const VALID_SOURCE_VALUES = SOURCE_OPTIONS.map((s) => s.value)
const SOURCE_LABEL_TO_VALUE = Object.fromEntries(SOURCE_OPTIONS.map((s) => [s.label.toLowerCase(), s.value]))
const VALID_TEMP_VALUES = LEAD_TEMPERATURE_OPTIONS.map((t) => t.value)
const TEMP_LABEL_TO_VALUE = Object.fromEntries(LEAD_TEMPERATURE_OPTIONS.map((t) => [t.label.toLowerCase(), t.value]))
const VALID_MODE_VALUES = ACTION_TYPE_OPTIONS.map((a) => a.value)
const MODE_LABEL_TO_VALUE = Object.fromEntries(ACTION_TYPE_OPTIONS.map((a) => [a.label.toLowerCase(), a.value]))
// Older status words still work in an Excel file.
const OLD_STATUS_TO_VALUE = {
  hot_lead: 'followup_required', warm_lead: 'followup_required', follow_up_required: 'followup_required',
  proposal_sent: 'followup_required', negotiation: 'followup_required', not_interested: 'lost_order',
  won: 'won_order', lost: 'lost_order'
}

function normalizeRow(rawRow) {
  const row = {}
  for (const key of Object.keys(rawRow)) {
    const normalizedKey = HEADER_ALIASES[key.trim().toLowerCase()]
    if (!normalizedKey) continue
    const raw = rawRow[key]
    // Keep the raw value (Date object / Excel serial number) for the date column —
    // stringifying it here would lose the type info needed to parse it correctly.
    row[normalizedKey] = normalizedKey === 'next_followup_date' ? raw : String(raw ?? '').trim()
  }
  return row
}

function normalizeName(s) {
  return String(s || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

function resolveStatus(value) {
  if (!value) return 'new_lead'
  const v = value.toLowerCase()
  const underscored = v.replace(/\s+/g, '_')
  if (STATUS_LABEL_TO_VALUE[v]) return STATUS_LABEL_TO_VALUE[v]
  if (VALID_STATUS_VALUES.includes(underscored)) return underscored
  if (OLD_STATUS_TO_VALUE[underscored]) return OLD_STATUS_TO_VALUE[underscored]
  return 'new_lead'
}

function resolveSource(value) {
  if (!value) return 'bulk_upload'
  const v = value.toLowerCase()
  if (VALID_SOURCE_VALUES.includes(v.replace(/\s+/g, '_'))) return v.replace(/\s+/g, '_')
  if (SOURCE_LABEL_TO_VALUE[v]) return SOURCE_LABEL_TO_VALUE[v]
  return 'other'
}

function resolveTemperature(value) {
  if (!value) return null
  const v = value.toLowerCase().trim()
  if (VALID_TEMP_VALUES.includes(v)) return v
  if (TEMP_LABEL_TO_VALUE[v]) return TEMP_LABEL_TO_VALUE[v]
  return null
}

function actionLabel(v) {
  return (ACTION_TYPE_OPTIONS.find((a) => a.value === v) || { label: v }).label
}

function resolveMode(value) {
  if (!value) return 'call'
  const v = value.toLowerCase().trim()
  if (VALID_MODE_VALUES.includes(v)) return v
  if (MODE_LABEL_TO_VALUE[v]) return MODE_LABEL_TO_VALUE[v]
  if (v === 'whats app' || v === 'wa') return 'whatsapp'
  return 'call'
}

function resolveExperience(value) {
  if (!value) return ''
  const hit = TRADING_EXPERIENCE_OPTIONS.find((x) => x.toLowerCase() === value.toLowerCase().trim())
  return hit || value
}

function resolveState(value) {
  if (!value) return ''
  const v = value.toLowerCase().trim()
  const alias = { orissa: 'Odisha', pondicherry: 'Puducherry', uttaranchal: 'Uttarakhand', 'new delhi': 'Delhi', 'nct of delhi': 'Delhi', 'j&k': 'Jammu and Kashmir', 'jammu & kashmir': 'Jammu and Kashmir', 'andaman & nicobar islands': 'Andaman and Nicobar Islands' }
  const hit = INDIA_STATES.find((x) => x.toLowerCase() === v) || alias[v]
  return hit || value
}

// Excel stores dates as a serial day-count from 1899-12-30. When a cell isn't
// read with cellDates, sheet_to_json hands back this raw number instead of a Date.
function excelSerialToDate(serial) {
  const utcDays = Math.floor(serial - 25569)
  const dateInfo = new Date(utcDays * 86400 * 1000)
  const fractionalDay = serial - Math.floor(serial)
  const totalSeconds = Math.round(86400 * fractionalDay)
  dateInfo.setSeconds(dateInfo.getSeconds() + totalSeconds)
  return dateInfo
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null

  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value.toISOString()
  }

  if (typeof value === 'number') {
    const d = excelSerialToDate(value)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }

  const str = String(value).trim()
  if (!str) return null

  // Explicit DD/MM/YYYY or DD-MM-YYYY (Indian format), optionally with a time.
  const dmy = str.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/)
  if (dmy) {
    let [, a, b, y, hh, mm] = dmy
    if (y.length === 2) y = (Number(y) < 70 ? '20' : '19') + y
    let day = Number(a)
    let month = Number(b)
    if (month > 12 && day <= 12) { const t = day; day = month; month = t } // handle MM/DD/YYYY fallback
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const dt = new Date(Number(y), month - 1, day, hh ? Number(hh) : 0, mm ? Number(mm) : 0)
      if (!isNaN(dt.getTime())) return dt.toISOString()
    }
  }

  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

export default function BulkUpload() {
  const navigate = useNavigate()
  const { session } = useAuth()

  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState([])
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [products, setProducts] = useState([])
  const [users, setUsers] = useState([])
  const [existingMobiles, setExistingMobiles] = useState(new Set())

  useEffect(() => {
    async function loadLookups() {
      const [productsRes, usersRes, leadsRes] = await Promise.all([
        supabase.from('products').select('id, product_name').eq('is_active', true),
        supabase.from('profiles').select('id, full_name').in('role', ['sales', 'bde', 'calling']),
        supabase.from('leads').select('mobile').not('mobile', 'is', null)
      ])
      setProducts(productsRes.data || [])
      setUsers(usersRes.data || [])
      setExistingMobiles(new Set((leadsRes.data || []).map((l) => String(l.mobile).trim())))
    }
    loadLookups()
  }, [])

  function resolveProductId(name) {
    if (!name) return null
    const target = normalizeName(name)
    const match = products.find((p) => normalizeName(p.product_name) === target)
    return match?.id || null
  }

  function resolveAssignedTo(name) {
    if (!name) return null
    const target = normalizeName(name)
    const match = users.find((u) => normalizeName(u.full_name) === target)
    return match?.id || null
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    setResult(null)
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target.result)
        const workbook = XLSX.read(data, { type: 'array', cellDates: true })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

        // Track mobile numbers seen earlier in this same file, so two rows
        // in one upload with the same number also get flagged as duplicates.
        const seenInFile = new Set()

        const processed = rawRows.map((r, i) => {
          const norm = normalizeRow(r)
          const issues = []
          if (!norm.lead_name) issues.push('Missing lead name')
          if (!norm.mobile) issues.push('Missing mobile no.')

          const mobileKey = String(norm.mobile || '').trim()
          if (mobileKey) {
            if (existingMobiles.has(mobileKey)) {
              issues.push('Duplicate — mobile already exists in CRM')
            } else if (seenInFile.has(mobileKey)) {
              issues.push('Duplicate — repeated within this file')
            }
            seenInFile.add(mobileKey)
          }

          const followupRawProvided = norm.next_followup_date !== undefined && norm.next_followup_date !== null && String(norm.next_followup_date).trim() !== ''
          const next_followup_date = parseDate(norm.next_followup_date)
          const followup_invalid = followupRawProvided && !next_followup_date

          const product_name = norm.product || ''
          const assigned_name = norm.assigned_to || ''
          const product_unmatched = !!product_name && !resolveProductId(product_name)
          const assigned_unmatched = !!assigned_name && !resolveAssignedTo(assigned_name)

          return {
            _row: i + 2,
            lead_name: norm.lead_name || '',
            mobile: norm.mobile || '',
            email: norm.email || '',
            industry_type: resolveExperience(norm.industry_type),
            state: resolveState(norm.state),
            city: norm.city || '',
            source: resolveSource(norm.source),
            status: resolveStatus(norm.status),
            lead_temperature: resolveTemperature(norm.lead_temperature),
            requirement: norm.requirement || '',
            product_name,
            assigned_name,
            product_unmatched,
            assigned_unmatched,
            next_followup_date,
            followup_invalid,
            next_action_type: resolveMode(norm.next_action_type),
            next_action: norm.next_action || '',
            valid: issues.length === 0,
            issues
          }
        })

        if (processed.length === 0) {
          setError('No rows found in this file. Please check the format.')
          setRows([])
        } else {
          setRows(processed)
        }
      } catch (err) {
        setError('Could not read this file. Please make sure it is a valid .xlsx, .xls, or .csv file.')
        setRows([])
      }
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleUpload() {
    const validRows = rows.filter((r) => r.valid)
    if (validRows.length === 0) return

    setUploading(true)
    const payload = validRows.map((r) => ({
      lead_name: r.lead_name,
      client_name: null,
      mobile: r.mobile || null,
      email: r.email || null,
      company: r.lead_name,
      industry_type: r.industry_type || null,
      state: r.state || null,
      city: r.city || null,
      source: r.source,
      status: r.status,
      lead_temperature: r.lead_temperature,
      requirement: r.requirement || null,
      product_id: resolveProductId(r.product_name),
      assigned_to: resolveAssignedTo(r.assigned_name),
      next_followup_date: r.next_followup_date,
      next_action_type: r.next_action_type,
      next_action: r.next_action || null,
      created_by: session?.user?.id
    }))

    const { error: insertError } = await supabase.from('leads').insert(payload)

    setUploading(false)

    if (insertError) {
      setError(insertError.message)
      return
    }

    setResult({ inserted: validRows.length, skipped: rows.length - validRows.length })
    setRows([])
  }

  function downloadTemplate() {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['Student Name', 'Mobile No.', 'Email', 'Trading Experience', 'State', 'City', 'Lead Source', 'Status', 'Priority', 'Interested Course', 'Preferred Course / Notes', 'Assigned Counsellor', 'Next Follow-up Date & Time', 'Follow-up Mode', 'Next Action'],
      ['Rahul Sharma', '9876543210', 'rahul@example.com', 'Beginner', 'Maharashtra', 'Pune', 'Meta / Facebook', 'New', 'Hot', 'Options Trading Mastery', 'Evening batch preferred', 'Priya Singh', '25/11/2026 14:30', 'WhatsApp', 'Send course brochure']
    ])
    XLSX.utils.book_append_sheet(wb, ws, 'Leads')
    XLSX.writeFile(wb, 'lead_upload_template.xlsx')
  }

  const validCount = rows.filter((r) => r.valid).length
  const invalidCount = rows.length - validCount

  return (
    <div>
      <button className="back-link" onClick={() => navigate('/leads')}>← Back to Leads</button>

      <div className="bulk-header">
        <div>
          <h1>Bulk Upload Leads</h1>
          <p className="bulk-subtitle">Upload an Excel (.xlsx) or CSV file to add multiple leads at once.</p>
        </div>
        <button className="btn-ghost" onClick={downloadTemplate}>Download Sample Template</button>
      </div>

      {result ? (
        <div className="info-card result-card">
          <h3>Upload Complete</h3>
          <p><strong>{result.inserted}</strong> leads were added successfully.</p>
          {result.skipped > 0 && <p>{result.skipped} row(s) were skipped due to missing data.</p>}
          <div className="bulk-actions">
            <button className="btn-primary" onClick={() => navigate('/leads')}>Go to Leads</button>
            <button className="btn-ghost" onClick={() => { setResult(null); setFileName('') }}>Upload Another File</button>
          </div>
        </div>
      ) : (
        <>
          <div className="info-card">
            <h3>1. Choose File</h3>
            <p className="bulk-hint">
              Expected columns: <strong>Student Name</strong> (required), <strong>Mobile No.</strong> (required), Email, Trading Experience (Beginner / Intermediate / Advanced), State, City, Lead Source, Status (New / Contacted / Interested / Not Interested / Converted), Priority (Hot / Warm / Cold), Interested Course, Preferred Course / Notes, Assigned Counsellor, Next Follow-up Date &amp; Time, Follow-up Mode (Call / WhatsApp / Visit), Next Action.
              Column names are matched flexibly — "Name", "Phone", "Course" etc. also work. Interested Course and Assigned Counsellor must match an existing Product / User name exactly (spelling can differ in case) — the preview below will flag any that don't match.
              Next Follow-up Date accepts a real Excel date cell, or text like <strong>25/09/2026</strong> or <strong>25/09/2026 14:30</strong>.
            </p>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="file-input" />
            {fileName && <p className="bulk-filename">Selected: {fileName}</p>}
            {error && <div className="form-error">{error}</div>}
          </div>

          {rows.length > 0 && (
            <div className="info-card">
              <div className="preview-header">
                <h3>2. Preview ({rows.length} rows)</h3>
                <div className="preview-counts">
                  <span className="count-good">{validCount} valid</span>
                  {invalidCount > 0 && <span className="count-bad">{invalidCount} will be skipped</span>}
                </div>
              </div>

              <div className="preview-table-wrap">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Student Name</th>
                      <th>Mobile No.</th>
                      <th>Experience</th>
                      <th>State</th>
                      <th>City</th>
                      <th>Source</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Interested Course</th>
                      <th>Counsellor</th>
                      <th>Next Follow-up</th>
                      <th>Mode</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map((r) => (
                      <tr key={r._row} className={r.valid ? '' : 'row-invalid'}>
                        <td>{r._row}</td>
                        <td>{r.lead_name || '—'}</td>
                        <td>{r.mobile || '—'}</td>
                        <td>{r.industry_type || '—'}</td>
                        <td>{r.state || '—'}</td>
                        <td>{r.city || '—'}</td>
                        <td>{r.source}</td>
                        <td>{statusMeta(r.status).label}</td>
                        <td>{r.lead_temperature ? r.lead_temperature.charAt(0).toUpperCase() + r.lead_temperature.slice(1) : '—'}</td>
                        <td>
                          {r.product_name || '—'}
                          {r.product_unmatched && <div className="tag-warn">Not found in Products — will save without course</div>}
                        </td>
                        <td>
                          {r.assigned_name || '—'}
                          {r.assigned_unmatched && <div className="tag-warn">Not found in Users — will stay unassigned</div>}
                        </td>
                        <td>
                          {r.next_followup_date
                            ? new Date(r.next_followup_date).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '—'}
                          {r.followup_invalid && <div className="tag-warn">Could not read this date — check format</div>}
                        </td>
                        <td>{r.next_followup_date || r.next_action ? (actionLabel(r.next_action_type)) : '—'}</td>
                        <td>{r.valid ? <span className="tag-ok">Valid</span> : <span className="tag-bad">{r.issues.join(', ')}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 50 && <p className="bulk-hint">Showing first 50 of {rows.length} rows.</p>}
              </div>

              <div className="bulk-actions">
                <button className="btn-primary" onClick={handleUpload} disabled={uploading || validCount === 0}>
                  {uploading ? 'Uploading…' : `Upload ${validCount} Lead${validCount === 1 ? '' : 's'}`}
                </button>
                <button className="btn-ghost" onClick={() => { setRows([]); setFileName('') }}>Cancel</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
