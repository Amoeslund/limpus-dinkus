-- Guild Pulse: tracks guild members' level, last online and recent level gains.
-- Data only refreshes while someone running the addon is logged in; history builds up from the first scan.

local ADDON = ...
local DAY = 86400
local WINDOW = 7 * DAY
local MAXLVL = (GetMaxPlayerLevel and GetMaxPlayerLevel()) or 60

local db                       -- GuildPulseDB[guildKey]
local view = { sort = "seen", desc = false, rank = nil, hideMax = false }
local rows, frame = {}, nil

local function guildKey()
    local name = GetGuildInfo("player")
    if not name then return nil end
    return name .. "-" .. (GetRealmName() or "?")
end

local function offlineHours(i)
    if not GetGuildRosterLastOnline then return nil end
    local y, m, d, h = GetGuildRosterLastOnline(i)
    if not y then return nil end
    return ((y * 12 + m) * 30 + d) * 24 + h
end

local MAXGAP = 180            -- seconds; longer gaps between scans (we were offline/loading) are not counted
local KEEP_DAYS = 30

local function dayKey(t) return date("%Y-%m-%d", t) end

local function addTime(buckets, day, dt)
    buckets[day] = (buckets[day] or 0) + dt
end

-- Sum of a day-bucket table over the last WINDOW, and how many of those days have entries.
local function recent(buckets, now)
    local total, days = 0, 0
    if not buckets then return 0, 0 end
    for i = 0, 6 do
        local v = buckets[dayKey(now - i * DAY)]
        if v and v > 0 then total, days = total + v, days + 1 end
    end
    return total, days
end

local function prune(buckets, now)
    if not buckets then return end
    local oldest = dayKey(now - KEEP_DAYS * DAY)
    for d in pairs(buckets) do if d < oldest then buckets[d] = nil end end
end

local function scan()
    local key = guildKey()
    if not key then return end
    GuildPulseDB[key] = GuildPulseDB[key] or { members = {} }
    db = GuildPulseDB[key]
    local now, seen = time(), {}
    -- Online-time tracking: credit the time since the previous scan to everyone who was online then.
    db.watched = db.watched or {}
    local dt = db.lastTick and (now - db.lastTick) or 0
    local credit = dt > 0 and dt <= MAXGAP
    local today = dayKey(now)
    if credit then
        addTime(db.watched, today, dt)
        for _, m in pairs(db.members) do
            if m.online and not m.gone then
                m.played = m.played or {}
                addTime(m.played, today, dt)
            end
        end
    end
    db.lastTick = now
    if not db.pruned or now - db.pruned > DAY then
        prune(db.watched, now)
        for _, m in pairs(db.members) do prune(m.played, now) end
        db.pruned = now
    end
    local n = GetNumGuildMembers()
    for i = 1, n do
        local name, rankName, rankIndex, level, classDisplay, zone, note, offNote, online, _, class = GetGuildRosterInfo(i)
        if name then
            name = Ambiguate(name, "guild")
            seen[name] = true
            local m = db.members[name]
            if not m then
                m = { firstSeen = now, levels = {} }
                db.members[name] = m
            end
            m.rank, m.rankIndex, m.class, m.classDisplay = rankName, rankIndex, class, classDisplay
            m.note, m.zone, m.online, m.gone = note, zone, online, nil
            local last
            if online then last = now else
                local hrs = offlineHours(i)
                if hrs then last = now - hrs * 3600 end
            end
            -- Blizzard rounds offline time down to hours/days; keep the newest value we know.
            if last and (not m.lastOnline or last > m.lastOnline or online) then m.lastOnline = last end
            local hist = m.levels
            if #hist == 0 or hist[#hist].l ~= level then hist[#hist + 1] = { t = now, l = level } end
            m.level = level
        end
    end
    if n > 0 then
        for name, m in pairs(db.members) do if not seen[name] then m.gone = m.gone or now end end
        db.scanned = now
    end
    if frame and frame:IsShown() then frame:Refresh() end
end

-- Level the member had WINDOW seconds ago (or when we first saw them, flagged as partial).
local function gain(m, now)
    local cutoff, base, partial = now - WINDOW, nil, false
    for _, e in ipairs(m.levels) do
        if e.t <= cutoff then base = e.l else break end
    end
    if not base then base, partial = m.levels[1] and m.levels[1].l or m.level, true end
    return (m.level or 0) - (base or 0), partial
end

local function ago(t, now)
    if not t then return "?" end
    local s = now - t
    if s < 3600 then return "online/now" end
    if s < DAY then return math.floor(s / 3600) .. "h" end
    return math.floor(s / DAY) .. "d"
end

local function seenColor(t, now)
    if not t then return "|cff999999" end
    local d = (now - t) / DAY
    if d < 2 then return "|cff40ff40" elseif d < 7 then return "|cffffd040" else return "|cffff5050" end
end

local function list()
    local now, out = time(), {}
    if not db then return out end
    for name, m in pairs(db.members) do
        if not m.gone and (not view.rank or m.rankIndex == view.rank) and not (view.hideMax and m.level == MAXLVL) then
            local g, partial = gain(m, now)
            local play = recent(m.played, now)
            local watched, wdays = recent(db.watched, now)
            out[#out + 1] = { name = name, m = m, gain = g, partial = partial, play = play,
                              avg = wdays > 0 and play / wdays or 0,
                              share = watched > 0 and play / watched or 0 }
        end
    end
    local key = view.sort
    table.sort(out, function(a, b)
        local x, y
        if key == "name" then x, y = a.name, b.name
        elseif key == "level" then x, y = a.m.level or 0, b.m.level or 0
        elseif key == "gain" then x, y = a.gain, b.gain
        elseif key == "play" then x, y = a.play, b.play
        elseif key == "avg" then x, y = a.avg, b.avg
        elseif key == "rank" then x, y = a.m.rankIndex or 99, b.m.rankIndex or 99
        else x, y = -(a.m.lastOnline or 0), -(b.m.lastOnline or 0) end
        if x == y then return a.name < b.name end
        if view.desc then return x > y end
        return x < y
    end)
    return out
end

local function hm(sec)
    if not sec or sec < 60 then return "-" end
    local h, m = math.floor(sec / 3600), math.floor(sec % 3600 / 60)
    if h == 0 then return m .. "m" end
    return string.format("%dh%02d", h, m)
end

local function jsonStr(v)
    v = tostring(v or ""):gsub('[%c"\\]', function(ch)
        if ch == '"' then return '\\"' elseif ch == "\\" then return "\\\\" elseif ch == "\n" then return "\\n" end
        return string.format("\\u%04x", ch:byte())
    end)
    return '"' .. v .. '"'
end

-- JSON for the guild site's roster page (loremforever.com/admin/roster). Always the whole roster, ignoring filters.
local function siteJSON()
    local now, parts = time(), {}
    if db then
        local watched, wdays = recent(db.watched, now)
        for name, m in pairs(db.members) do
            if not m.gone then
                local play = recent(m.played, now)
                parts[#parts + 1] = string.format(
                    '{"name":%s,"level":%d,"rank":%s,"rankIndex":%d,"lastOnline":%s,"seen7d":%d,"avgDay":%d,"share":%.3f}',
                    jsonStr(name), m.level or 0, jsonStr(m.rank), m.rankIndex or -1,
                    m.online and tostring(now) or (m.lastOnline and tostring(m.lastOnline) or "null"),
                    play, wdays > 0 and math.floor(play / wdays) or 0, watched > 0 and play / watched or 0)
            end
        end
    end
    return string.format('{"addon":"GuildPulse","version":1,"at":%d,"members":[%s]}', now, table.concat(parts, ","))
end

local function exportText()
    local now, lines = time(), { "Name;Level;+7d;Rank;LastOnline;Seen7d;AvgPerDay;SharePct;Note" }
    for _, r in ipairs(list()) do
        lines[#lines + 1] = string.format("%s;%d;%s%d;%s;%s;%s;%s;%d;%s", r.name, r.m.level or 0, r.partial and "~" or "",
            r.gain, r.m.rank or "", ago(r.m.lastOnline, now), hm(r.play), hm(r.avg), r.share * 100,
            ((r.m.note or ""):gsub(";", ",")))
    end
    return table.concat(lines, "\n")
end

-- UI ------------------------------------------------------------------------

local COLS = {
    { key = "name",  label = "Name",        w = 130 },
    { key = "level", label = "Lvl",         w = 40 },
    { key = "gain",  label = "+7d",         w = 45 },
    { key = "rank",  label = "Rank",        w = 110 },
    { key = "seen",  label = "Last online", w = 80 },
    { key = "play",  label = "Seen 7d",     w = 65 },
    { key = "avg",   label = "Avg/day",     w = 60 },
    { key = "note",  label = "Note",        w = 140 },
}
local ROWH, NROWS = 16, 24

local function rankLabel()
    if not view.rank then return "Rank: all" end
    return "Rank: " .. (GuildControlGetRankName and GuildControlGetRankName(view.rank + 1) or view.rank)
end

local function build()
    frame = CreateFrame("Frame", "GuildPulseFrame", UIParent, "BasicFrameTemplateWithInset")
    frame:SetSize(720, 110 + ROWH * NROWS)
    frame:SetPoint("CENTER")
    frame:SetMovable(true); frame:EnableMouse(true)
    frame:RegisterForDrag("LeftButton")
    frame:SetScript("OnDragStart", frame.StartMoving)
    frame:SetScript("OnDragStop", frame.StopMovingOrSizing)
    frame:SetFrameStrata("HIGH")
    tinsert(UISpecialFrames, "GuildPulseFrame")
    frame.TitleText:SetText("Guild Pulse")

    local x = 14
    for _, c in ipairs(COLS) do
        local b = CreateFrame("Button", nil, frame)
        b:SetSize(c.w, 18); b:SetPoint("TOPLEFT", x, -58)
        b:SetNormalFontObject("GameFontNormalSmall"); b:SetText(c.label)
        b:GetFontString():SetPoint("LEFT")
        if c.key ~= "note" then
            b:SetScript("OnClick", function()
                if view.sort == c.key then view.desc = not view.desc else view.sort, view.desc = c.key, c.key == "level" or c.key == "gain" or c.key == "play" or c.key == "avg" end
                frame:Refresh()
            end)
        end
        c.x = x; x = x + c.w
    end

    local function button(text, w, anchorX, onClick)
        local b = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
        b:SetSize(w, 22); b:SetPoint("TOPLEFT", anchorX, -30); b:SetText(text)
        b:SetScript("OnClick", onClick)
        return b
    end
    frame.rankBtn = button(rankLabel(), 150, 12, function(_, mouse)
        local nr = (GuildControlGetNumRanks and GuildControlGetNumRanks()) or 10
        if view.rank == nil then view.rank = 0 elseif view.rank >= nr - 1 then view.rank = nil else view.rank = view.rank + 1 end
        frame:Refresh()
    end)
    frame.maxBtn = button("Hide max level: off", 140, 166, function()
        view.hideMax = not view.hideMax; frame:Refresh()
    end)
    button("Rescan", 70, 310, function() C_GuildInfo.GuildRoster() end)
    button("Export", 70, 384, function() frame:ShowExport(exportText()) end)
    button("Export for site", 110, 458, function() frame:ShowExport(siteJSON()) end)
    frame.status = frame:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
    frame.status:SetPoint("TOPRIGHT", -36, -6)  -- in the title bar, clear of the buttons

    local scroll = CreateFrame("ScrollFrame", "GuildPulseScroll", frame, "FauxScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", 10, -78); scroll:SetPoint("BOTTOMRIGHT", -32, 30)
    scroll:SetScript("OnVerticalScroll", function(self, off) FauxScrollFrame_OnVerticalScroll(self, off, ROWH, function() frame:Refresh() end) end)
    frame.scroll = scroll

    for i = 1, NROWS do
        local r = CreateFrame("Frame", nil, frame)
        r:SetSize(690, ROWH); r:SetPoint("TOPLEFT", 14, -78 - (i - 1) * ROWH)
        r.cells = {}
        for j, c in ipairs(COLS) do
            local fs = r:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
            fs:SetPoint("LEFT", c.x - 14, 0); fs:SetWidth(c.w - 4); fs:SetJustifyH("LEFT"); fs:SetWordWrap(false)
            r.cells[j] = fs
        end
        rows[i] = r
    end

    frame.legend = frame:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
    frame.legend:SetPoint("BOTTOMLEFT", 14, 10)
    frame.legend:SetText("+7d: levels gained (~ = <7d history). Seen 7d / Avg/day: online time while YOU were online (per day you logged in); % = share of your time.")

    function frame:Refresh()
        local now, data = time(), list()
        self.rankBtn:SetText(rankLabel())
        self.maxBtn:SetText("Hide max level: " .. (view.hideMax and "on" or "off"))
        local watched = db and recent(db.watched, now) or 0
        self.status:SetText(string.format("%d shown · watched %s in 7d · scanned %s", #data, hm(watched), db and db.scanned and ago(db.scanned, now) or "never"))
        FauxScrollFrame_Update(self.scroll, #data, NROWS, ROWH)
        local off = FauxScrollFrame_GetOffset(self.scroll)
        for i = 1, NROWS do
            local r, d = rows[i], data[i + off]
            if d then
                local m = d.m
                local cc = m.class and RAID_CLASS_COLORS[m.class]
                local stale = d.gain == 0 and (m.level or 0) < MAXLVL and not d.partial
                r.cells[1]:SetText((cc and ("|c" .. cc.colorStr) or "") .. d.name .. "|r")
                r.cells[2]:SetText(m.level or "?")
                r.cells[3]:SetText((stale and "|cffff5050" or (d.gain > 0 and "|cff40ff40" or "")) .. (d.partial and "~" or "") .. d.gain .. "|r")
                r.cells[4]:SetText(m.rank or "")
                r.cells[5]:SetText(seenColor(m.lastOnline, now) .. (m.online and "online" or ago(m.lastOnline, now)) .. "|r")
                r.cells[6]:SetText(hm(d.play))
                r.cells[7]:SetText(hm(d.avg) .. (d.play > 0 and string.format(" |cff999999%d%%|r", d.share * 100) or ""))
                r.cells[8]:SetText(m.note or "")
                r:Show()
            else
                r:Hide()
            end
        end
    end

    function frame:ShowExport(text)
        if not self.export then
            local e = CreateFrame("Frame", nil, self, "BasicFrameTemplateWithInset")
            e:SetSize(460, 300); e:SetPoint("CENTER"); e:SetFrameLevel(self:GetFrameLevel() + 20)
            e.TitleText:SetText("Copy with Ctrl+C")
            local sf = CreateFrame("ScrollFrame", nil, e, "UIPanelScrollFrameTemplate")
            sf:SetPoint("TOPLEFT", 12, -30); sf:SetPoint("BOTTOMRIGHT", -32, 12)
            local eb = CreateFrame("EditBox", nil, sf)
            eb:SetMultiLine(true); eb:SetFontObject("ChatFontNormal"); eb:SetWidth(400); eb:SetAutoFocus(false)
            eb:SetScript("OnEscapePressed", function() e:Hide() end)
            sf:SetScrollChild(eb)
            e.eb = eb
            self.export = e
        end
        self.export.eb:SetText(text)
        self.export:Show(); self.export.eb:SetFocus(); self.export.eb:HighlightText()
    end
end

local function toggle()
    if not IsInGuild() then print("|cff40c0ffGuild Pulse:|r you are not in a guild.") return end
    if not frame then build() end
    if frame:IsShown() then frame:Hide() else
        C_GuildInfo.GuildRoster()
        frame:Show(); frame:Refresh()
    end
end

-- Extra panel under the Guild & Communities member detail popup -------------

local detailPanel

local function memberText(name)
    if not db or not name then return nil end
    name = Ambiguate(name, "guild")
    local m = db.members[name]
    if not m then return nil end
    local now = time()
    local g, partial = gain(m, now)
    local play = recent(m.played, now)
    local watched, wdays = recent(db.watched, now)
    local lines = {
        string.format("|cffffd100Levels 7d:|r %s%d  |cff999999(lvl %d)|r", partial and "~" or "+", g, m.level or 0),
        string.format("|cffffd100Seen online 7d:|r %s", hm(play)),
        string.format("|cffffd100Avg/day:|r %s  |cff999999(%d%% of your %s)|r",
            hm(wdays > 0 and play / wdays or 0), watched > 0 and play / watched * 100 or 0, hm(watched)),
        string.format("|cffffd100Tracked since:|r %s", date("%d %b", m.firstSeen or now)),
    }
    return table.concat(lines, "\n")
end

local function attachDetail(detail, getName)
    if not detail or detail.GuildPulseHooked then return end
    detail.GuildPulseHooked = true
    detailPanel = CreateFrame("Frame", nil, detail, "TooltipBackdropTemplate")
    detailPanel:SetPoint("TOPLEFT", detail, "BOTTOMLEFT", 0, 2)
    detailPanel:SetPoint("TOPRIGHT", detail, "BOTTOMRIGHT", 0, 2)
    detailPanel:SetHeight(78)
    local title = detailPanel:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    title:SetPoint("TOPLEFT", 10, -8); title:SetText("Guild Pulse")
    detailPanel.text = detailPanel:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    detailPanel.text:SetPoint("TOPLEFT", title, "BOTTOMLEFT", 0, -4)
    detailPanel.text:SetPoint("RIGHT", -10, 0)
    detailPanel.text:SetJustifyH("LEFT")
    local function update()
        local txt = memberText(getName())
        detailPanel.text:SetText(txt or "|cff999999No data yet for this member.|r")
        detailPanel:SetHeight(26 + detailPanel.text:GetStringHeight())
    end
    detail:HookScript("OnShow", update)
    if detail.DisplayMember then hooksecurefunc(detail, "DisplayMember", update) end
    detail.GuildPulseUpdate = update
end

local function hookCommunities()
    local detail = CommunitiesFrame and CommunitiesFrame.GuildMemberDetailFrame
    attachDetail(detail, function()
        local mi = detail.memberInfo
        if mi and mi.name then return mi.name end
        return detail.Name and detail.Name:GetText()
    end)
end

local function hookOldGuildFrame()
    attachDetail(GuildMemberDetailFrame, function()
        local i = GetGuildRosterSelection and GetGuildRosterSelection()
        return i and i > 0 and (GetGuildRosterInfo(i)) or nil
    end)
end

SLASH_GUILDPULSE1, SLASH_GUILDPULSE2 = "/gpulse", "/guildpulse"
SlashCmdList.GUILDPULSE = function(msg)
    msg = (msg or ""):lower()
    if msg == "reset" then
        local key = guildKey()
        if key then GuildPulseDB[key] = nil; db = nil end
        print("|cff40c0ffGuild Pulse:|r history cleared for this guild.")
    else
        toggle()
    end
end

local ev = CreateFrame("Frame")
ev:RegisterEvent("PLAYER_LOGIN")
ev:RegisterEvent("GUILD_ROSTER_UPDATE")
ev:RegisterEvent("ADDON_LOADED")
ev:SetScript("OnEvent", function(_, event, arg)
    if event == "ADDON_LOADED" then
        if arg == "Blizzard_Communities" then hookCommunities()
        elseif arg == "Blizzard_GuildUI" then hookOldGuildFrame() end
        return
    end
    if event == "PLAYER_LOGIN" then
        if CommunitiesFrame then hookCommunities() end
        if GuildMemberDetailFrame then hookOldGuildFrame() end
        GuildPulseDB = GuildPulseDB or {}
        -- Ask the server for the roster now and every minute while logged in (read-only request);
        -- the per-minute refresh is what makes the online-time tracking accurate.
        C_Timer.After(5, function() if IsInGuild() then C_GuildInfo.GuildRoster() end end)
        C_Timer.NewTicker(60, function() if IsInGuild() then C_GuildInfo.GuildRoster() end end)
    else
        if GuildPulseDB then scan() end
    end
end)
