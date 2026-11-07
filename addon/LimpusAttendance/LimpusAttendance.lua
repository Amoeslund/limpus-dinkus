-- Limpus Attendance: records who was in the raid on every boss kill.
-- /limpus          -> stored kill count and last kill date
-- /limpus export   -> JSON for the guild site's /admin import
-- /limpus clear    -> delete all stored kills (typed confirmation)

local PRUNE_SECONDS = 60 * 24 * 60 * 60

local function Print(msg)
    print("|cff66ccffLimpus:|r " .. msg)
end

-- Same escaping as Darklight's JStr: backslash, quote, control characters.
local function JStr(s)
    s = tostring(s or "")
    s = s:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r"):gsub("\t", "\\t")
    s = s:gsub("[%z\1-\31]", function(c) return string.format("\\u%04x", c:byte()) end)
    return '"' .. s .. '"'
end

local function Kills()
    LimpusAttendanceDB = LimpusAttendanceDB or { kills = {} }
    LimpusAttendanceDB.kills = LimpusAttendanceDB.kills or {}
    return LimpusAttendanceDB.kills
end

local function BuildJSON()
    local items = {}
    for _, k in ipairs(Kills()) do
        local names = {}
        for _, n in ipairs(k.raid or {}) do names[#names + 1] = JStr(n) end
        items[#items + 1] = "{" .. table.concat({
            '"t":' .. tostring(k.t or 0),
            '"zone":' .. JStr(k.zone),
            '"boss":' .. JStr(k.boss),
            '"raid":[' .. table.concat(names, ",") .. "]",
        }, ",") .. "}"
    end
    return "{" .. table.concat({
        '"addon":"LimpusAttendance"',
        '"version":1',
        '"exportedAt":' .. tostring(time()),
        '"kills":[' .. table.concat(items, ",") .. "]",
    }, ",") .. "}"
end

local DIALOG_BACKDROP = {
    bgFile = "Interface\\DialogFrame\\UI-DialogBox-Background",
    edgeFile = "Interface\\DialogFrame\\UI-DialogBox-Border",
    tile = true, tileSize = 32, edgeSize = 32,
    insets = { left = 8, right = 8, top = 8, bottom = 8 },
}

-- ---------------------------------------------------------------------------
-- Export frame
-- ---------------------------------------------------------------------------
local exportFrame, exportBox, exportPayload

local function InitExportFrame()
    if exportFrame then return end
    local f = CreateFrame("Frame", "LimpusAttendanceExportFrame", UIParent, "BackdropTemplate")
    f:SetSize(560, 420)
    f:SetPoint("CENTER", UIParent, "CENTER", 0, 40)
    f:SetFrameStrata("DIALOG")
    f:SetMovable(true); f:EnableMouse(true); f:RegisterForDrag("LeftButton")
    f:SetScript("OnDragStart", f.StartMoving)
    f:SetScript("OnDragStop", f.StopMovingOrSizing)
    f:SetBackdrop(DIALOG_BACKDROP)
    f:Hide()
    tinsert(UISpecialFrames, "LimpusAttendanceExportFrame")
    exportFrame = f

    local title = f:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    title:SetPoint("TOP", f, "TOP", 0, -18)
    title:SetText("Limpus Attendance export")

    local label = f:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    label:SetPoint("TOP", title, "BOTTOM", 0, -6)
    label:SetText("Press Ctrl+C to copy")

    local close = CreateFrame("Button", nil, f, "UIPanelCloseButton")
    close:SetPoint("TOPRIGHT", f, "TOPRIGHT", -4, -4)

    local scroll = CreateFrame("ScrollFrame", "LimpusAttendanceExportScroll", f, "UIPanelScrollFrameTemplate")
    scroll:SetPoint("TOPLEFT", f, "TOPLEFT", 20, -70)
    scroll:SetPoint("BOTTOMRIGHT", f, "BOTTOMRIGHT", -40, 20)

    local eb = CreateFrame("EditBox", nil, scroll)
    eb:SetMultiLine(true); eb:SetAutoFocus(false); eb:SetMaxLetters(0)
    eb:SetFontObject("GameFontHighlightSmall")
    eb:SetWidth(500)
    scroll:SetScrollChild(eb)
    eb:SetScript("OnEscapePressed", function(self) self:ClearFocus(); f:Hide() end)
    -- Keep the payload read-only: any typed change restores it.
    eb:SetScript("OnTextChanged", function(self, user)
        if user and exportPayload then self:SetText(exportPayload); self:HighlightText() end
    end)
    eb:SetScript("OnEditFocusGained", function(self) self:HighlightText() end)
    eb:SetScript("OnMouseUp", function(self) self:SetFocus(); self:HighlightText() end)
    exportBox = eb
end

local function ShowExport()
    InitExportFrame()
    exportPayload = BuildJSON()
    exportBox:SetText(exportPayload)
    exportFrame:Show()
    exportBox:SetFocus()
    exportBox:HighlightText()
    -- Layout settles next frame; select again so the whole text is ready for Ctrl+C.
    C_Timer.After(0.05, function()
        if exportFrame:IsShown() then exportBox:SetFocus(); exportBox:HighlightText() end
    end)
end

-- ---------------------------------------------------------------------------
-- Clear confirmation (typed "clear")
-- ---------------------------------------------------------------------------
local clearFrame, clearBox, clearConfirm, clearDesc

local function InitClearDialog()
    if clearFrame then return end
    local d = CreateFrame("Frame", "LimpusAttendanceClearFrame", UIParent, "BackdropTemplate")
    d:SetSize(360, 200)
    d:SetPoint("CENTER", UIParent, "CENTER", 0, 80)
    d:SetFrameStrata("DIALOG")
    d:EnableMouse(true)
    d:SetBackdrop(DIALOG_BACKDROP)
    d:Hide()
    tinsert(UISpecialFrames, "LimpusAttendanceClearFrame")
    clearFrame = d

    local title = d:CreateFontString(nil, "OVERLAY", "GameFontNormalLarge")
    title:SetPoint("TOP", d, "TOP", 0, -18)
    title:SetText("Clear stored kills")

    clearDesc = d:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
    clearDesc:SetPoint("TOPLEFT", d, "TOPLEFT", 24, -48)
    clearDesc:SetPoint("TOPRIGHT", d, "TOPRIGHT", -24, -48)
    clearDesc:SetJustifyH("CENTER"); clearDesc:SetWordWrap(true)

    local prompt = d:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
    prompt:SetPoint("TOP", d, "TOP", 0, -88)
    prompt:SetText('Type "clear" to confirm')

    local eb = CreateFrame("EditBox", "LimpusAttendanceClearInput", d, "InputBoxTemplate")
    eb:SetSize(140, 26)
    eb:SetPoint("TOP", prompt, "BOTTOM", 0, -8)
    eb:SetAutoFocus(false)
    eb:SetMaxLetters(16)
    eb:SetJustifyH("CENTER")
    clearBox = eb

    local confirm = CreateFrame("Button", nil, d, "UIPanelButtonTemplate")
    confirm:SetSize(130, 26)
    confirm:SetPoint("BOTTOMRIGHT", d, "BOTTOM", -6, 20)
    confirm:SetText("Clear")
    confirm:Disable()
    clearConfirm = confirm

    local cancel = CreateFrame("Button", nil, d, "UIPanelButtonTemplate")
    cancel:SetSize(130, 26)
    cancel:SetPoint("BOTTOMLEFT", d, "BOTTOM", 6, 20)
    cancel:SetText("Cancel")
    cancel:SetScript("OnClick", function() d:Hide() end)

    local function typedClear()
        return strlower(strtrim(eb:GetText() or "")) == "clear"
    end
    local function doClear()
        if not typedClear() then return end
        local n = #Kills()
        LimpusAttendanceDB.kills = {}
        Print(string.format("cleared %d kills", n))
        d:Hide()
    end
    eb:SetScript("OnTextChanged", function() confirm:SetEnabled(typedClear()) end)
    eb:SetScript("OnEnterPressed", doClear)
    eb:SetScript("OnEscapePressed", function() d:Hide() end)
    confirm:SetScript("OnClick", doClear)
    d:SetScript("OnHide", function() eb:SetText(""); eb:ClearFocus(); confirm:Disable() end)
end

local function ShowClearDialog()
    InitClearDialog()
    clearDesc:SetText(string.format("This deletes all %d stored kills. Export first if you have not imported them.", #Kills()))
    clearBox:SetText("")
    clearConfirm:Disable()
    clearFrame:Show()
    clearBox:SetFocus()
end

-- ---------------------------------------------------------------------------
-- Events and slash command
-- ---------------------------------------------------------------------------
local ev = CreateFrame("Frame")
ev:RegisterEvent("ADDON_LOADED")
ev:RegisterEvent("ENCOUNTER_END")
ev:SetScript("OnEvent", function(_, event, ...)
    if event == "ADDON_LOADED" then
        local name = ...
        if name ~= "LimpusAttendance" then return end
        LimpusAttendanceDB = LimpusAttendanceDB or { kills = {} }
        LimpusAttendanceDB.kills = LimpusAttendanceDB.kills or {}
        local cutoff = time() - PRUNE_SECONDS
        local kept = {}
        for _, k in ipairs(LimpusAttendanceDB.kills) do
            if (k.t or 0) >= cutoff then kept[#kept + 1] = k end
        end
        LimpusAttendanceDB.kills = kept
    elseif event == "ENCOUNTER_END" then
        local _, encounterName, _, _, success = ...
        if success ~= 1 or not IsInRaid() then return end
        local raid = {}
        for i = 1, GetNumGroupMembers() do
            -- Offline at the kill = not attending (officers can add players manually).
            local n, _, _, _, _, _, _, online = GetRaidRosterInfo(i)
            if n and online then raid[#raid + 1] = n end
        end
        local kills = Kills()
        kills[#kills + 1] = { t = time(), zone = (GetInstanceInfo()), boss = encounterName, raid = raid }
        Print(string.format("recorded %s (%d players)", tostring(encounterName), #raid))
    end
end)

SLASH_LIMPUS1 = "/limpus"
SlashCmdList["LIMPUS"] = function(msg)
    local cmd = strlower(strtrim(msg or ""))
    if cmd == "export" then
        ShowExport()
    elseif cmd == "clear" then
        ShowClearDialog()
    else
        local kills = Kills()
        local n = #kills
        if n == 0 then
            Print("0 kills")
        else
            Print(string.format("%d kills, last on %s", n, date("%Y-%m-%d %H:%M", kills[n].t or 0)))
        end
        Print("/limpus export - copy JSON for the site, /limpus clear - delete stored kills")
    end
end
