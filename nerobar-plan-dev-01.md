# NeroBar — Codex Multi-Account Manager Plan
> Wersja robocza · 2026-02-22

---

## 0. Kontekst — co znalazłem w repozytorium

### Jak NeroBar obsługuje Codex dzisiaj

| Plik | Rola |
|------|------|
| `Sources/CodexBarCore/Providers/Codex/CodexCLISession.swift` | Uruchamia trwały proces `codex` przez PTY; wysyła `/status` żeby pobrać limit rate |
| `Sources/CodexBarCore/Providers/Codex/CodexStatusProbe.swift` | Interpretuje wynik `/status` → `RateWindow` |
| `Sources/CodexBarCore/Providers/Codex/CodexUsageDataSource.swift` | Decyduje: CLI / web / auth-token / auto |
| `Sources/CodexBarCore/OpenAIWeb/OpenAIDashboardFetcher.swift` | Scrape web dashboardu OpenAI → credits remaining, code-review % |
| `Sources/CodexBarCore/UsageFetcher.swift` | Unified `RateWindow { usedPercent, windowMinutes, resetsAt }` — to jest wbudowany mechanizm limitów |
| `Sources/CodexBarCore/TokenAccounts.swift` | Multi-account per provider — `ProviderTokenAccountData { accounts[], activeIndex }` — w `AppSupport/CodexBar/token-accounts.json` |
| `Sources/CodexBarCLI/CLIUsageCommand.swift` | `codexbar-cli usage [--account <label>] [--account-index <n>] [--all-accounts]` |
| `Sources/CodexBarCLI/TokenAccountCLI.swift` | Resolver CLI → wybiera konto z listy |

### Format `~/.codex/auth.json` (Codex OAuth)

```json
{
  "auth_mode": "chatgpt",
  "tokens": {
    "id_token":     "<JWT>",
    "access_token": "<JWT>",
    "refresh_token": "rt_...",
    "account_id":   "<uuid>"
  },
  "last_refresh": "2026-02-19T19:10:46Z"
}
```

JWT `id_token` zawiera w claimie `https://api.openai.com/auth`:
- `email`
- `chatgpt_plan_type` (plus / pro / free)
- `chatgpt_subscription_active_until` (ISO timestamp)
- `chatgpt_account_id`

### Storage slotów (już istnieje)

```
~/.codex/
  auth.json          ← aktywny slot (live)
  auth/
    01/auth.json     ← slot 1
    02/auth.json     ← slot 2
    03/auth.json     ← slot 3
    04/auth.json     ← slot 4
    05/auth.json     ← slot 5
```

---

## 1. Fazy implementacji

### FAZA 1 — `codex-account` CLI (Node.js/shell, działamy na Linuksie)

Plik: `~/.local/bin/codex-account` (lub `/usr/local/bin/codex-account`)  
Implementacja: Node.js ESM (jeden plik, zero deps).

#### Komendy

```
codex-account list               # pokaż wszystkie sloty
codex-account status             # aktywny slot (z auth.json)
codex-account switch <n>         # przełącz na slot N (cp + symlink)
codex-account best               # drukuje numer najlepszego slotu
codex-account info <n>           # szczegóły konkretnego slotu
```

#### Logika `list`

Dla każdego slotu 01–05 (oraz `opencode pool` jeśli istnieje):
1. Odczyt `~/.codex/auth/NN/auth.json`
2. Dekoduj JWT `id_token` (base64url, bez weryfikacji podpisu — tylko odczyt claimów)
3. Wyciągnij: `email`, `plan`, `subscription_active_until`, `account_id`
4. Oblicz: `expired = now > subscription_active_until`
5. Oblicz: `token_age = now - last_refresh` (access_token wygasa po ~1h typowo)

Przykładowy output:

```
SLOT  EMAIL                          PLAN  SUB_UNTIL    TOKEN_AGE  STATUS
[01]  alice@example.com              plus  2026-03-08   3d         OK
[02]  lucas@photography.com          plus  2026-02-17   1h         SUB_EXPIRED ⚠
[03]  (empty)
[04]  bob@example.com                pro   2026-04-01   2h         OK ★ ACTIVE
[05]  charlie@example.com            plus  2026-03-15   8h         TOKEN_STALE ⚠
```

Legenda wyświetlana pod tabelą.

#### Logika `best` (selektor konta)

Priorytety wagi (malejąco):
1. Subskrypcja aktywna (nie wygasła) — **warunek konieczny**
2. Plan: `pro` > `plus` > `free`
3. Token świeży (`last_refresh` < 30 min temu → ready to go)
4. Sub ważna najdłużej (więcej czasu do `subscription_active_until`)

Zwraca numer slotu (np. `04`) lub `none` jeśli żaden slot aktywny.

#### Logika `switch <n>`

```bash
cp ~/.codex/auth/NN/auth.json ~/.codex/auth.json
echo "Switched to slot NN (email)"
```

Przed kopią — backup: `~/.codex/auth.json.bak`.

---

### FAZA 2 — `codexx` wrapper

Plik: `~/.local/bin/codexx`

```
codexx [codex args...]
```

Przepływ:
1. `BEST=$(codex-account best)`
2. Jeśli `BEST == none` → print warning, uruchom codex na aktywnym koncie (fallback)
3. `codex-account switch $BEST` (cichy)
4. `exec codex "$@"`

Czyli identyczne UX z codex, tylko poprzedzone automatycznym wyborem konta.  
**Nie dynamicznie** — przełącza raz przy starcie i oddaje sterowanie.

---

### FAZA 3 — NeroBar: wyświetlenie multi-account dla Codex

> To jest część Swift w NeroBar. Dotyczy macOS, ale architektura i informacje
> o slocie można przygotować cross-platform przez shared JSON.

#### 3a. Shared state file

`~/.codex/account-status.json` — generowany przez `codex-account` (lub refreshowany co N min przez daemon):

```json
{
  "generated_at": "2026-02-22T10:00:00Z",
  "active_slot": "04",
  "slots": {
    "01": {
      "email": "alice@example.com",
      "plan": "plus",
      "sub_until": "2026-03-08T15:15:42Z",
      "last_refresh": "2026-02-22T07:00:00Z",
      "token_stale": false,
      "sub_expired": false
    }
  }
}
```

#### 3b. NeroBar menu extension

W `MenuDescriptor.swift` (sekcja Codex) — dodaj submenu:

```
◉ Codex  [alice@example.com · plus]
  ├ Accounts
  │  ├ [01] alice@example.com (plus) · token OK
  │  ├ [02] lucas@... (plus) · ⚠ SUB EXPIRED
  │  ├ [04] bob@... (pro) · token OK  ★ active
  │  └ Switch Account... → otwiera Terminal z `codex-account switch N`
  └ Refresh Accounts
```

#### 3c. Wskaźnik ważności

W `MenuCardView.swift` (sekcja Codex) — pod email dodaj:

- Zielony – sub ważna > 14 dni, token świeży
- Żółty – sub wygasa < 7 dni LUB token stary > 6h
- Czerwony – sub wygasła LUB token stary > 24h (wymaga relogin)

---

### FAZA 4 — Komunikacja ważności / ostrzeżenia

W `SessionQuotaNotifications.swift` (już istnieje) — dodaj nowy typ notyfikacji:

```swift
case codexAuthExpiringSoon(slot: String, email: String, daysLeft: Int)
case codexAuthExpired(slot: String, email: String)
case codexTokenStale(slot: String, email: String, ageHours: Int)
```

Trigger: przy starcie NeroBar i co 1h — odczyt `account-status.json`.

Komunikat użytkownikowi:
> "Codex · slot 02 · sub wygasła 5 dni temu → zaloguj się ponownie"
> "Codex · slot 05 · token ma 8h → odśwież sesję przed użyciem"

---

### FAZA 5 — Auto-refresh hint (NOT auto-login, tylko podpowiedź)

Automatyczna auto-autoryzacja jest niemożliwa bez przeglądarki/headless Chrome,  
więc system **komunikuje** zamiast robić za użytkownika:

- Jeśli `token_age > threshold` → wyświetl inline hint: "Run: `codex login`"
- Dodać komendę `codex-account refresh <n>` która:
  - `codex-account switch N` (ustawia slot jako aktywny)
  - drukuje: `Run: codex login` albo otwiera przeglądarkę jeśli OS=macOS

W przyszłości: jeśli codex CLI obsługuje `--refresh-token` flow → zautomatyzować.

---

## 2. Pliki do stworzenia / zmodyfikowania

### Nowe pliki (cross-platform / shell)

| Plik | Opis |
|------|------|
| `~/.local/bin/codex-account` | CLI multi-account manager, Node.js ESM |
| `~/.local/bin/codexx` | Wrapper z auto-select best account |
| `~/.codex/account-status.json` | Shared state generowany przez CLI |

### Modyfikacje NeroBar (Swift, macOS)

| Plik | Zmiana |
|------|--------|
| `Sources/CodexBar/MenuDescriptor.swift` | Nowe submenu Accounts dla Codex |
| `Sources/CodexBar/MenuCardView.swift` | Wskaźnik ważności tokenu/sub |
| `Sources/CodexBar/SessionQuotaNotifications.swift` | Typy notyfikacji auth |
| `Sources/CodexBarCore/Providers/Codex/CodexProviderDescriptor.swift` | Odczyt `account-status.json` |

---

## 3. Kolejność implementacji (recommended)

```
[1] codex-account CLI                 ← działa na Linuksie od razu, można testować
[2] codexx wrapper                    ← trivial po [1]  
[3] account-status.json schema        ← kontrakt między CLI a NeroBar
[4] NeroBar: read account-status.json ← macOS, po [3]
[5] NeroBar: menu multi-account       ← macOS, po [4]
[6] NeroBar: auth freshness indicator ← macOS, po [5]
[7] NeroBar: quota notifications auth ← macOS, po [6]
```

---

## 4. Odpowiedź na pytanie "czy dobre myślenie?"

**TAK**, logika jest poprawna i elegancka:

- Slot-based storage (`auth/NN/auth.json`) to prosty, przejrzysty mechanizm — odpowiednik numerowanych profili, bez żadnych zewnętrznych baz.
- Copy-to-active (`cp NN/auth.json auth.json`) to jedyne co codex CLI potrzebuje — system pliku jest jego interfejsem.
- Dekodowanie JWT bez weryfikacji to właściwe podejście do odczytu local claims (klucz prywatny nie jest potrzebny do czytania).
- `codexx` jako one-shot launcher (select best → exec codex) jest lepszy niż daemon — prosto, deterministycznie, bez side-effectów.
- `account-status.json` jako shared-state pozwala NeroBar (macOS) i CLI (Linux/macOS) czytać te same dane bez duplikowania logiki.

Jedyna uwaga: token refresh (OAuth refresh_token flow) można zautomatyzować w przyszłości — `refresh_token` jest w JWT i codex CLI prawdopodobnie już go obsługuje przez `codex login`. To jest Faza 5+.

---

## 5. Szybki start (co zrobić teraz)

```bash
# 1. Stwórz codex-account CLI
vim ~/.local/bin/codex-account
chmod +x ~/.local/bin/codex-account

# 2. Test
codex-account list

# 3. Stwórz codexx wrapper
vim ~/.local/bin/codexx
chmod +x ~/.local/bin/codexx

# 4. Test pełnego flow
codexx --help
```

Implementację `codex-account` zaczynam od Node.js — powiedzieć kiedy i zaczynam kodować.
