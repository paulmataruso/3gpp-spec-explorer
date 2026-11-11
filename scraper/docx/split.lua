-- Pandoc Lua filter: split one part of a 3GPP .docx (read with -f docx+styles) into sections.
--
-- Env:
--   SPLIT_OUT         ndjson file to append {"id":..., "html":...} lines to
--   SPLIT_IDS         file with one "<toc id>\t<depth>" per line (the spec's table of contents)
--   SPLIT_IMG_PREFIX  prefix for figure names, e.g. "36.523-1/images/p3-"
--
-- The driver (convert_docx.py) replaces every run-level <w:tab/> with U+E000 before pandoc
-- reads the file, because pandoc turns tabs into spaces; we turn it back into "\t" inside
-- code blocks and into <span class="tab"></span> elsewhere.
--
-- Output HTML follows shared/render.ts conventions: <pre class="asn1">, <p class="note|cap|ctr|b1..">,
-- <figure class="fig"><img data-src=...>, math as <span class="tex" data-display="0|1">TeX</span>
-- (rendered with KaTeX by build-db).

local out_path = os.getenv('SPLIT_OUT')
local img_prefix = os.getenv('SPLIT_IMG_PREFIX') or ''
local TAB = '\u{E000}'

local ids, depth_of, ord_of = {}, {}, {}
local n_ids = 0
for line in io.lines(os.getenv('SPLIT_IDS')) do
  local id, d = line:match('^([^\t]+)\t?(%d*)$')
  if id then
    n_ids = n_ids + 1
    ids[id] = true
    depth_of[id] = tonumber(d) or 0
    ord_of[id] = ord_of[id] or n_ids
  end
end
-- TOC position of the next numbered entry after each position (an unnumbered heading such as 38.331's
-- "– BCCH-BCH-Message" is only taken for a TOC entry between the last one matched and that position)
local next_numbered, numbered_at = {}, {}
for id, o in pairs(ord_of) do
  if id:match('^%d') or id:match('^%a%.%d') or id:match('^annex%-') then numbered_at[o] = true end
end
do
  local nxt = n_ids + 1
  for o = n_ids, 0, -1 do
    next_numbered[o] = nxt
    if numbered_at[o] then nxt = o end
  end
end
local last_ord = 0

local ESC = { ['&'] = '&amp;', ['<'] = '&lt;', ['>'] = '&gt;', ['"'] = '&quot;' }
local function esc(s) return (s:gsub('[&<>"]', ESC)) end

local function json_str(s)
  s = s:gsub('[%c"\\]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    if c == '\n' then return '\\n' end
    if c == '\r' then return '\\r' end
    if c == '\t' then return '\\t' end
    return string.format('\\u%04x', c:byte())
  end)
  return '"' .. s .. '"'
end

-- paragraph styles of the 3GPP template -> classes understood by the reader's CSS
local STYLE_CLASS = {
  NO = 'note', NW = 'note', TAN = 'note',
  TH = 'cap', TF = 'cap',
  EX = 'ex', EW = 'ex', EQ = 'ctr',
  B1 = 'b1', B2 = 'b2', B3 = 'b3', B4 = 'b4', B5 = 'b5',
  ['B1+'] = 'b1', BN = 'b1', BL = 'b1',
  TAC = 'ctr', TAH = 'ctr th', TAR = 'rgt',
}

local function style_of(el)
  if el.t == 'Div' and el.attributes then return el.attributes['custom-style'] end
  return nil
end

local function len_px(v)
  if not v then return nil end
  local n, u = tostring(v):match('^([%d%.]+)(%a*)$')
  n = tonumber(n)
  if not n then return nil end
  if u == 'in' then n = n * 96
  elseif u == 'cm' then n = n * 37.795
  elseif u == 'mm' then n = n * 3.7795
  elseif u == 'pt' then n = n * 96 / 72
  elseif u ~= '' and u ~= 'px' then return nil end
  return math.floor(n + 0.5)
end

local function img_html(img)
  local name = (img.src:match('([^/]+)$') or img.src):gsub('%.%w+$', '.png')
  local w, h = len_px(img.attributes.width), len_px(img.attributes.height)
  local dims = ''
  if w and h and w > 0 and h > 0 then
    dims = string.format(' width="%d" height="%d" style="aspect-ratio:%d/%d"', w, h, w, h)
  end
  return '<img data-src="' .. esc(img_prefix .. name) .. '" alt="Figure"' .. dims .. ' loading="lazy" decoding="async">'
end

-- Para/Plain holding only images (and whitespace) -> <figure>; otherwise images become inline <img>
local function image_block(inl)
  local imgs, other = {}, false
  for _, x in ipairs(inl) do
    if x.t == 'Image' then table.insert(imgs, x)
    elseif x.t ~= 'Space' and x.t ~= 'SoftBreak' and x.t ~= 'LineBreak' and not (x.t == 'Str' and x.text:gsub(TAB, '') == '') then other = true end
  end
  if #imgs == 0 then return nil end
  if not other then
    local parts = {}
    for _, i in ipairs(imgs) do table.insert(parts, img_html(i)) end
    return pandoc.RawBlock('html', '<figure class="fig">' .. table.concat(parts) .. '</figure>')
  end
  return nil
end

local function inline_images(inl)
  return inl:walk({ Image = function(i) return pandoc.RawInline('html', img_html(i)) end })
end

-- text of code inlines, keeping line breaks (stringify turns them into spaces)
local function code_text(inlines)
  local out = {}
  for _, il in ipairs(inlines) do
    if il.t == 'Str' then
      table.insert(out, il.text)
    elseif il.t == 'Space' then
      table.insert(out, ' ')
    elseif il.t == 'LineBreak' or il.t == 'SoftBreak' then
      table.insert(out, '\n')
    elseif il.t == 'Code' then
      table.insert(out, il.text)
    elseif il.t ~= 'Note' and il.t ~= 'Image' and type(il.content) == 'table' then
      table.insert(out, code_text(il.content))
    else
      table.insert(out, pandoc.utils.stringify(il))
    end
  end
  return table.concat(out)
end

local function code_lines(blocks)
  local lines = {}
  for _, b in ipairs(blocks) do
    if b.t == 'Para' or b.t == 'Plain' then
      local s = code_text(b.content):gsub(TAB, '\t'):gsub('\u{00A0}', ' ')
      table.insert(lines, s)
    elseif b.t == 'Div' or b.t == 'BlockQuote' then
      -- pandoc makes an indented paragraph a BlockQuote (24.247's SIP examples: PL with w:ind left=851)
      for _, l in ipairs(code_lines(b.content)) do table.insert(lines, l) end
    elseif b.t == 'LineBlock' then
      for _, l in ipairs(b.content) do table.insert(lines, (code_text(l):gsub(TAB, '\t'):gsub('\u{00A0}', ' '))) end
    elseif b.t == 'CodeBlock' then
      for l in (b.text .. '\n'):gmatch('(.-)\n') do table.insert(lines, l) end
    elseif b.t ~= 'HorizontalRule' and b.t ~= 'Null' then
      -- whatever else pandoc made of a code paragraph (lists, tables): its text, never nothing
      local s = pandoc.utils.stringify(b):gsub(TAB, '\t'):gsub('\u{00A0}', ' ')
      table.insert(lines, s)
    end
  end
  return lines
end

-- pass 1: styles, code, figures, headings
local pass1 = {
  Para = function(p) return image_block(p.content) or pandoc.Para(inline_images(p.content)) end,
  Plain = function(p) return image_block(p.content) or pandoc.Plain(inline_images(p.content)) end,
  Header = function(h)
    h.identifier = ''
    h.classes = {}
    h.attributes = {}
    if h.level < 4 then h.level = 4 end
    return h
  end,
  Span = function(s) return s.content end,
  Link = function(l)
    if l.target:match('^https?://') then return l end
    return l.content
  end,
  Div = function(d)
    local st = style_of(d)
    if st and st:match('^PL') then
      return pandoc.CodeBlock(table.concat(code_lines(d.content), '\n'), pandoc.Attr('', { 'asn1' }))
    end
    if st == 'LD' then
      -- line drawings: message sequences and boxes drawn with characters in a monospaced font
      return pandoc.CodeBlock(table.concat(code_lines(d.content), '\n'), pandoc.Attr('', { 'ld' }))
    end
    local cls = st and STYLE_CLASS[st]
    if cls then
      local out = {}
      for _, b in ipairs(d.content) do
        if b.t == 'Para' or b.t == 'Plain' then
          table.insert(out, pandoc.Div({ pandoc.Para(b.content) }, pandoc.Attr('', { 'p-' .. cls:gsub(' ', ' p-') })))
        else
          table.insert(out, b)
        end
      end
      return out
    end
    return d.content
  end,
}

-- pass 2: tabs and math (after code blocks captured the raw tabs)
local pass2 = {
  Str = function(s)
    if not s.text:find(TAB, 1, true) then return nil end
    local out = {}
    local first = true
    for piece in (s.text .. TAB):gmatch('(.-)' .. TAB) do
      if not first then table.insert(out, pandoc.RawInline('html', '<span class="tab"></span>')) end
      if piece ~= '' then table.insert(out, pandoc.Str(piece)) end
      first = false
    end
    return out
  end,
  Math = function(m)
    local disp = m.mathtype == 'DisplayMath' and '1' or '0'
    return pandoc.RawInline('html', '<span class="tex" data-display="' .. disp .. '">' .. esc(m.text) .. '</span>')
  end,
  CodeBlock = function(c)
    local lang = 'asn1'
    if c.classes[1] == 'ld' then lang = 'ld'
    elseif c.text:match('^%s*openapi:%s') or c.text:match('\nopenapi:%s') then lang = 'yaml' end
    return pandoc.RawBlock('html', '<pre class="' .. lang .. '"><code>' .. esc(c.text) .. '</code></pre>')
  end,
}

local function render(blocks)
  local doc = pandoc.Pandoc(blocks)
  doc = doc:walk(pass1)
  -- merge consecutive code blocks (one per PL paragraph group)
  local merged = {}
  for _, b in ipairs(doc.blocks) do
    local prev = merged[#merged]
    -- an indented plain paragraph right after code continues it (YAML lines added without the PL style)
    local cont = nil
    if prev and prev.t == 'CodeBlock' and (b.t == 'Para' or b.t == 'Plain') then
      local txt = code_text(b.content)
      if txt:match('^\u{00A0}\u{00A0}') then cont = (txt:gsub(TAB, '\t'):gsub('\u{00A0}', ' ')) end
    end
    if b.t == 'CodeBlock' and prev and prev.t == 'CodeBlock' and (prev.classes[1] or '') == (b.classes[1] or '') then
      prev.text = prev.text .. '\n' .. b.text
    elseif cont then
      prev.text = prev.text .. '\n' .. cont
    else
      table.insert(merged, b)
    end
  end
  doc = pandoc.Pandoc(merged):walk(pass2)
  return pandoc.write(doc, 'html5', { wrap_text = 'none' })
end

local function slug(s)
  return (s:lower():gsub('[^%w]+', '-'):gsub('^%-+', ''):gsub('%-+$', ''))
end

local function heading_text(b)
  local st = style_of(b)
  if b.t == 'Header' or (st and (st:match('^Heading') or st == 'H6' or st:match('^TT'))) then
    return (pandoc.utils.stringify(b):gsub(TAB, ' '))
  end
  return nil
end

-- Word auto-numbered headings (no number in the text) come out of pandoc as items of an OrderedList;
-- such lists are unwrapped so that every heading is seen at the top level
local function list_has_heading(b)
  for _, item in ipairs(b.content) do
    for _, x in ipairs(item) do
      if heading_text(x) then return true end
      if (x.t == 'OrderedList' or x.t == 'BulletList') and list_has_heading(x) then return true end
    end
  end
  return false
end
local function unwrap_heading_lists(blocks, out)
  out = out or {}
  for _, b in ipairs(blocks) do
    if (b.t == 'OrderedList' or b.t == 'BulletList') and list_has_heading(b) then
      for _, item in ipairs(b.content) do unwrap_heading_lists(item, out) end
    else
      table.insert(out, b)
    end
  end
  return out
end

local used = {}
-- SPLIT_DISCOVER=1: the document's own headings are the table of contents (itecspec has none, or one
-- whose unnumbered entries repeat the same id) - every numbered / annex / other heading starts a section.
-- Unnumbered headings ("Initial conditions", or every heading of a document that uses Word auto-numbering)
-- get ids unique within the document: "<enclosing clause>--<slug>[-n]", the enclosing clause found through
-- the heading levels. SPLIT_SEEN lists ids emitted by earlier parts of the same document; SPLIT_STACK
-- carries the open heading levels from one part to the next.
local discover = os.getenv('SPLIT_DISCOVER') == '1'
local seen = {}
do
  local sp = os.getenv('SPLIT_SEEN')
  local f = sp and io.open(sp)
  if f then
    for l in f:lines() do seen[l] = true end
    f:close()
  end
end
local stack = {} -- open headings: { level, id, numbered }
local stack_path = os.getenv('SPLIT_STACK')
do
  local f = stack_path and io.open(stack_path)
  if f then
    for l in f:lines() do
      local lv, id, nb = l:match('^([%d.]+)\t([^\t]+)\t(%d)$')
      if lv then table.insert(stack, { level = tonumber(lv), id = id, numbered = nb == '1' }) end
    end
    f:close()
  end
end
local function pop_to(level)
  while #stack > 0 and stack[#stack].level >= level do table.remove(stack) end
end
local function unique(base)
  local id, k = base, 1
  while used[id] or seen[id] do
    k = k + 1
    id = base .. '-' .. k
  end
  return id
end

-- outline level of a heading block: Heading N -> N, H6 -> 6, annex titles (Heading 8/9) -> 0
local function heading_level(b, text)
  if text:match('^%s*Annex%s+%w') then return 0 end
  if b.t == 'Header' then return math.min(b.level, 7) end
  local st = style_of(b)
  if st then
    local n = st:match('^Heading%s*(%d)')
    if n then return math.min(tonumber(n), 7) end
    if st == 'H6' then return 6 end
  end
  return 7
end

local function discover_id(text, level)
  local t = text:gsub('^%s+', ''):gsub('%s+$', '')
  local annex = t:match('^Annex%s+(%w+)')
  if annex then
    local id = unique('annex-' .. annex:lower())
    pop_to(0)
    table.insert(stack, { level = 0, id = id, numbered = true })
    return id, nil, t, 0
  end
  -- clause numbers, including RAN5 test-case variants such as 9.1.19.2_1.5 or 6.4B.1.4_1.6.3
  local num, rest = t:match('^(%d[%w_]*[%.%w%-_]*)%s+(.*)$')
  if not num then num, rest = t:match('^(%u%.%d[%.%w%-_]*)%s+(.*)$') end
  if num then
    pop_to(level)
    num = num:gsub('[%.%-_]+$', '')
    -- a clause number used twice (editing slips) still gets its own entry: 5.2.1, 5.2.1-2
    local id = unique(num:lower())
    table.insert(stack, { level = level, id = id, numbered = true })
    return id, num, rest, level
  end
  local sl = slug(t)
  if sl == '' or sl == 'contents' then return nil end
  -- an unnumbered heading does not close a numbered one of the same style: test specs style both
  -- "6.1.1 Test Purpose (TP)" and its sub-headings "System Simulator:", "UE:" as H6
  while #stack > 0 and (stack[#stack].level > level or (stack[#stack].level == level and not stack[#stack].numbered)) do
    table.remove(stack)
  end
  if #stack > 0 and stack[#stack].numbered and stack[#stack].level == level then level = level + 0.5 end
  -- context: the nearest enclosing numbered clause, else the nearest enclosing heading
  local ctx
  for i = #stack, 1, -1 do
    if stack[i].numbered then
      ctx = stack[i].id
      break
    end
  end
  if not ctx and #stack > 0 then ctx = (stack[#stack].id:gsub('^.*%-%-', '')) end
  local id = unique(ctx and (ctx .. '--' .. sl) or sl)
  table.insert(stack, { level = level, id = id, numbered = false })
  return id, nil, t, level
end

-- itecspec's id for a title whose number it could not read ("6.2.1_1.1 Test purpose", "AF.3 Procedure ...",
-- "Annex <X> (informative): Change history"): the whole title, dots kept, cut to 80 characters
local function dotslug(s)
  return (s:lower():gsub('[^%w%.]+', '-'):gsub('^%-+', ''):gsub('%-+$', ''))
end

-- which TOC entry (if any) does this heading start?
local function section_id(text)
  local t = text:gsub('^%s+', ''):gsub('%s+$', '')
  local ds = dotslug(t)
  for _, c in ipairs({ ds, (ds:sub(1, 80):gsub('%-+$', '')) }) do
    if ids[c] and not used[c] and not c:match('^[%d%.]+$') and (c:match('%d') or c:match('^annex%-')) then return c end
  end
  local annex = t:match('^Annex%s+([%w]+)')
  if annex then
    local id = 'annex-' .. annex:lower()
    if ids[id] then return id end
  end
  local num = t:match('^(%d[%w]*[%.%w%-]*)') or t:match('^(%u%.[%d][%.%w%-]*)')
  if num then
    num = num:gsub('[%.%-]+$', ''):lower()
    if ids[num] then return num end
    if ids[num .. '.'] and not used[num .. '.'] then return num .. '.' end  -- "6.5.3.3.4.3." in 38.521-5
    return nil
  end
  -- unnumbered headings: top-level ones (Foreword, Introduction, ...) and, deeper down, those the TOC
  -- lists right after the last entry matched (the messages and IEs of 38.331 6.2/6.3) - first occurrence only
  local s = slug(t)
  if ids[s] and not used[s] then
    local o = ord_of[s]
    if depth_of[s] == 0 or (o > last_ord and o < next_numbered[last_ord]) then return s end
  end
  return nil
end

-- Documents of the GSM era (and text taken from PDFs) carry no heading styles: every paragraph is
-- "Normal" and a heading is a paragraph that starts with its clause number ("1.1.2 Simultaneous use").
-- Which of those paragraphs are headings is decided for the whole part at once: the chosen ones must
-- number on plausibly (4.2 -> 4.2.1 / 4.3 / 5; an annex starts the numbering over), and each scores by
-- the text that follows it - so the list of contents (bare entries) and numbered table rows or list items
-- ("2 Int. - Ext.", "3 GHz") lose against the real headings: the best-scoring chain wins.
local function clause_key(num)
  local k = {}
  for part in num:gmatch('[^%.]+') do k[#k + 1] = tonumber(part) or (100 + (part:upper():byte(1) - 64)) end
  return k
end
local function follows(k, last)
  if not last then return k[1] <= 2 or k[1] >= 100 end
  local i = 1
  while i <= #k and i <= #last and k[i] == last[i] do i = i + 1 end
  if i > #k then return false end -- same number again, or a parent of the previous one
  local step = k[i] - (last[i] or 0)
  if i <= #last and (step < 1 or step > 2) then return false end
  if i > #last and (k[i] > 2) then return false end
  for j = i + 1, #k do if k[j] > 2 then return false end end
  return true
end
local function increasing(k, last)
  for i = 1, math.max(#k, #last) do
    local x, y = k[i] or -1, last[i] or -1
    if x ~= y then return x > y end
  end
  return false
end
local function is_child(k, parent)
  if #k ~= #parent + 1 then return false end
  for i = 1, #parent do if k[i] ~= parent[i] then return false end end
  return true
end
local function promote_numbered(blocks)
  local styled = 0
  for _, b in ipairs(blocks) do if heading_text(b) then styled = styled + 1 end end
  if styled >= 3 then return blocks end
  local cont -- a continuation part starts from the clause the previous part ended in
  for i = #stack, 1, -1 do
    if stack[i].numbered and stack[i].id:match('^%d[%d%.]*$') then
      cont = clause_key(stack[i].id)
      break
    end
  end
  -- 1. candidates: { at = block index, key = clause key | nil, annex = index | nil, text = header text }
  local cands, text_after = {}, {}
  for bi, b in ipairs(blocks) do
    local c
    local st = style_of(b) or ''
    local para = b.t == 'Para' or b.t == 'Plain'
        or (b.t == 'Div' and #b.content == 1 and (b.content[1].t == 'Para' or b.content[1].t == 'Plain'))
    local t = ''
    if para and not st:lower():match('^toc') then
      t = pandoc.utils.stringify(b):gsub(TAB, ' '):gsub('\u{00A0}', ' '):gsub('%s+', ' '):gsub('^ ', ''):gsub(' $', '')
      local leaders = t:find('%. ?%. ?%.') or t:find('\u{2026}') or t:find('_____')
      if #t <= 160 and not leaders then
        local word, an, rest = t:match('^(%a+) +(%w+)[ :.%-\u{2013}]*(.*)$')
        word = word and word:lower()
        if (word == 'annex' or word == 'appendix') and #an <= 3 and (tonumber(an) or an:match('^%a$')) then
          local idx = tonumber(an) or (an:upper():byte(1) - 64)
          local label = (word == 'annex' and 'Annex ' or 'Appendix ') .. an:upper()
          c = { annex = idx + (word == 'appendix' and 100 or 0), text = label .. (rest ~= '' and (': ' .. rest) or '') }
        else
          local num, title = t:match('^(%d+[%.%d]*) +(%S.*)$')
          if not num then num, title = t:match('^(%u%.%d[%.%d]*) +(%S.*)$') end
          if num then num = num:gsub('%.+$', '') end
          if num and not num:find('%.%.') and #title >= 2 and title:match('^[%a(]') and not title:match('[.,;]$')
              and select(2, num:gsub('%.', '')) < 6 then
            c = { key = clause_key(num), text = num .. ' ' .. title }
          end
        end
      end
    end
    if c then
      c.at = bi
      cands[#cands + 1] = c
      text_after[#cands] = 0
    elseif #cands > 0 then
      text_after[#cands] = text_after[#cands] + #(t ~= '' and t or pandoc.utils.stringify(b))
    end
  end
  if #cands == 0 then return blocks end
  -- 2. weights: text after it -> 1; a parent directly followed by its first child -> 0.2; a bare entry -> -0.6
  for i, c in ipairs(cands) do
    local nxt = cands[i + 1]
    if text_after[i] >= 20 then c.w = 1
    elseif nxt and ((c.key and nxt.key and is_child(nxt.key, c.key)) or (c.annex and nxt.key and follows(nxt.key, nil))) then c.w = 0.2
    else c.w = -0.6 end
  end
  -- cost of ci coming right after cj in the chain (nil: not allowed); a jump that skips clauses is allowed
  -- at a price, for the delta documents that hold only the changed clauses (04.08dcs: 3.2.2.2 -> 4.4.1)
  local JUMP = 0.4
  local function cost(ci, cj)
    if ci.key and cj.key then
      if follows(ci.key, cj.key) then return 0 end
      return increasing(ci.key, cj.key) and JUMP or nil
    end
    if ci.key then return follows(ci.key, nil) and 0 or JUMP end -- numbering starts over in an annex
    if cj.key then return 0 end
    return ci.annex > cj.annex and 0 or nil
  end
  -- 3. best chain (dynamic programming over candidates, predecessors within a window)
  local best, prev = {}, {}
  local top, top_i = 0, nil
  for i, c in ipairs(cands) do
    local b = (c.annex or follows(c.key, cont)) and 0 or -JUMP
    local p
    for j = i - 1, math.max(1, i - 1500), -1 do
      if best[j] - JUMP > b or best[j] > b then
        local x = cost(c, cands[j])
        if x and best[j] - x > b then b, p = best[j] - x, j end
      end
    end
    best[i], prev[i] = b + c.w, p
    if best[i] > top then top, top_i = best[i], i end
  end
  local chosen = {}
  while top_i do
    chosen[cands[top_i].at] = cands[top_i]
    top_i = prev[top_i]
  end
  local out = {}
  for bi, b in ipairs(blocks) do
    local c = chosen[bi]
    if c then
      out[#out + 1] = pandoc.Header(c.key and math.min(#c.key, 6) or 1, { pandoc.Str(c.text) })
    else
      out[#out + 1] = b
    end
  end
  return out
end

function Pandoc(doc)
  local sections = {}
  local current = nil
  local function flush()
    if current and (current.title or #current.blocks > 0) then
      table.insert(sections, { id = current.id, num = current.num, title = current.title, level = current.level, html = render(current.blocks) })
    end
  end
  local blocks = unwrap_heading_lists(doc.blocks)
  if discover then
    blocks = promote_numbered(blocks)
    -- a later part of a multi-file document goes on with the clause the previous part ended in
    if #stack > 0 then current = { id = stack[#stack].id, blocks = {} } end
  end
  for _, b in ipairs(blocks) do
    local htext = heading_text(b)
    local id, num, title, level
    if htext and discover then
      local st = style_of(b)
      if not (st and st:match('^TT')) then id, num, title, level = discover_id(htext, heading_level(b, htext)) end
    else
      id = htext and section_id(htext)
    end
    if id and not used[id] then
      flush()
      used[id] = true
      if not discover and ord_of[id] then last_ord = ord_of[id] end
      current = { id = id, num = num, title = title, level = level, blocks = {} }
    elseif current then
      table.insert(current.blocks, b)
    end
  end
  flush()
  if discover and #sections == 0 and #blocks > 0 and #stack == 0 then
    -- no heading at all: the whole text as one section rather than nothing
    table.insert(sections, { id = unique('document'), title = 'Document', level = 1, html = render(blocks) })
  end
  if discover and stack_path then
    local sf = io.open(stack_path, 'w')
    for _, e in ipairs(stack) do sf:write(e.level, '\t', e.id, '\t', e.numbered and '1' or '0', '\n') end
    sf:close()
  end
  local f = io.open(out_path, 'a')
  for _, s in ipairs(sections) do
    local extra = ''
    if s.title then
      extra = ',"title":' .. json_str(s.title) .. (s.num and (',"num":' .. json_str(s.num)) or '') .. (s.level and (',"level":' .. s.level) or '')
    end
    f:write('{"id":' .. json_str(s.id) .. extra .. ',"html":' .. json_str(s.html) .. '}', '\n')
  end
  f:close()
  return pandoc.Pandoc({})
end
