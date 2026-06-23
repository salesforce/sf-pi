# SF Docs separates result cards from evidence packets

SF Docs fetches can return enough official documentation text to ground model answers, but rendering that same text directly in the transcript creates noisy, scroll-heavy sessions. We will keep human-facing Docs Result Cards compact and citation-rich, while the model receives a separately bounded Docs Evidence Packet; tool details store renderer-safe metadata, counts, truncation flags, headings, and bounded previews rather than duplicating full fetched document bodies.
