import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import './SearchableSelect.css'

export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Search…',
  emptyLabel = '-- None --',
  disabled = false,
  allowCustom = false
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [rect, setRect] = useState(null)
  const wrapRef = useRef(null)
  const dropdownRef = useRef(null)

  const selected = options.find((o) => o.value === value)
  // With allowCustom a value that is not in the list (typed by hand) is shown as it is.
  const shownLabel = selected ? selected.label : (value || '')

  useEffect(() => {
    setQuery(shownLabel)
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateRect = useCallback(() => {
    if (wrapRef.current) {
      const r = wrapRef.current.getBoundingClientRect()
      setRect({ top: r.bottom + 4, left: r.left, width: r.width })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    updateRect()
    // capture:true so this fires even when a nested container (e.g. a table wrapper) scrolls
    window.addEventListener('scroll', updateRect, true)
    window.addEventListener('resize', updateRect)
    return () => {
      window.removeEventListener('scroll', updateRect, true)
      window.removeEventListener('resize', updateRect)
    }
  }, [open, updateRect])

  useEffect(() => {
    function onClickOutside(e) {
      if (
        wrapRef.current && !wrapRef.current.contains(e.target) &&
        dropdownRef.current && !dropdownRef.current.contains(e.target)
      ) {
        setOpen(false)
        commitTyped()
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [selected, query, allowCustom, value])

  const filtered = options.filter((o) => {
    const q = query.toLowerCase()
    return (
      o.label.toLowerCase().includes(q) ||
      (o.sublabel && o.sublabel.toLowerCase().includes(q))
    )
  })

  // When the box is left: keep the typed text if custom values are allowed, else snap back.
  function commitTyped() {
    const typed = query.trim()
    if (!allowCustom) { setQuery(shownLabel); return }
    const hit = options.find((o) => o.label.toLowerCase() === typed.toLowerCase())
    const next = hit ? hit.value : typed
    if (next !== value) onChange(next)
    setQuery(hit ? hit.label : typed)
  }

  function handleSelect(opt) {
    onChange(opt ? opt.value : '')
    setQuery(opt ? opt.label : '')
    setOpen(false)
  }

  function handleOpen() {
    updateRect()
    setOpen(true)
  }

  return (
    <div className="searchable-select" ref={wrapRef}>
      <input
        type="text"
        className="text-input"
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={handleOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (filtered.length > 0) handleSelect(filtered[0])
            else if (allowCustom) { commitTyped(); setOpen(false) }
          }
          if (e.key === 'Escape') { setOpen(false); setQuery(shownLabel) }
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!open) handleOpen()
        }}
      />
      {(value || query) && !disabled && (
        <button
          type="button"
          className="searchable-select-clear"
          onMouseDown={(e) => { e.preventDefault(); handleSelect(null) }}
          aria-label="Clear selection"
        >
          ✕
        </button>
      )}

      {open && !disabled && rect && createPortal(
        <div
          ref={dropdownRef}
          className="searchable-select-dropdown"
          style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width }}
        >
          <button
            type="button"
            className="searchable-select-option muted"
            onMouseDown={(e) => { e.preventDefault(); handleSelect(null) }}
          >
            {emptyLabel}
          </button>
          {filtered.length === 0 ? (
            <div className="searchable-select-empty">
              {allowCustom && query.trim() ? `Use “${query.trim()}” (type & click outside)` : 'No matches'}
            </div>
          ) : (
            filtered.map((opt) => (
              <button
                type="button"
                key={opt.value}
                className={'searchable-select-option' + (opt.value === value ? ' active' : '')}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(opt) }}
              >
                <span>{opt.label}</span>
                {opt.sublabel && <span className="searchable-select-sublabel">{opt.sublabel}</span>}
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
