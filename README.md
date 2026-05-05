# Buchhaltung Marc Hobi

Private, login-geschützte Next.js-Web-App für eine kleine EÜR-orientierte Buchhaltung mit Fokus auf EUR/CHF, Einnahmen, Ausgaben, Bank- & Wechselgebühren, Fahrten, Reisen, Abschreibungen und Jahresexporte.

## Enthalten

- Next.js + TypeScript + Tailwind CSS
- Supabase Auth mit E-Mail/Passwort
- Supabase Postgres mit `user_id` auf allen relevanten Tabellen
- Row Level Security für alle Finanzdaten
- Deutsche Oberfläche
- Historische CHF/EUR-Kursabfrage mit manuellem Fallback
- Dashboard aus Live-Datenbankwerten
- Reise-Workflow mit Startpunkt, Stopps, Rückkehr und Segment-Kilometern
- CSV-Exporte und HTML-Druckansicht für den Jahresreport

## Projektstruktur

- `src/app`: App Router Seiten, API-Routen und Server Actions
- `src/components`: Formulare, Layout und Tabellen
- `src/lib`: Berechnungslogik, Typen, Supabase-Helfer
- `supabase/migrations`: SQL-Migrationen inkl. RLS

## Setup

1. Abhängigkeiten installieren

```bash
npm install
```

2. Neues Supabase-Projekt anlegen

- Auth aktivieren
- E-Mail/Passwort-Login erlauben

3. Umgebungsvariablen setzen

`.env.local` anlegen:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

4. Migration ausführen

- Datei `supabase/migrations/202604260001_init.sql` im Supabase SQL Editor ausführen
- Alternativ mit der Supabase CLI migrieren

5. Entwicklungsserver starten

```bash
npm run dev
```

6. Deployment zu Vercel

- Projekt bei Vercel importieren
- dieselben Environment-Variablen setzen
- sicherstellen, dass die Supabase-URL und der Anon-Key korrekt hinterlegt sind

## Wichtige fachliche Punkte

- CHF wird per historischem Tageskurs nach EUR umgerechnet.
- Wenn die Online-Kursabfrage fehlschlägt, bleibt manuelle Eingabe möglich.
- Einnahmen speichern Rechnungsbetrag und echten Zahlungseingang getrennt.
- Positive Differenzen bei Einnahmen werden automatisch als `Zahlungsdifferenz aus Einnahme` bei Bankgebühren gespiegelt.
- Ausgaben zeigen immer den steuerlich absetzbaren Anteil.
- Abschreibungen werden linear berechnet.
- Reisen zeigen Startpunkt, Zwischenstopps und Endpunkt dauerhaft sichtbar an.

## Sicherheitsmodell

- Supabase Auth schützt den Login
- Alle Finanztabellen enthalten `user_id`
- Alle Finanztabellen haben RLS-Policies für `select`, `insert`, `update`, `delete`
- Der Supabase Service Role Key wird nicht im Frontend verwendet

## Bekannte MVP-Grenzen / Annahmen

- Die HTML-Druckansicht dient als PDF-Basis über „Als PDF drucken“, statt serverseitiger PDF-Erzeugung.
- Die Reiseerfassung speichert Stopps und Segmente bereits sauber, aber automatische Distanzberechnung ist noch nicht an einen Geocoding-/Routing-Dienst angebunden.
- Die Verpflegungspauschalen enthalten als Startbasis Deutschland, Schweiz, England, Portugal und Frankreich aus der vorhandenen Excel-Logik. Für weitere Länder oder Jahresänderungen sollte die Referenzliste erweitert werden.
- Das aktuelle MVP bietet für die Kernmodule sichere Erfassung, Übersicht und Löschen. Ein voll ausgebauter Bearbeitungsdialog je Datensatz ist als nächster sinnvoller Ausbau vorgesehen.
- Die App ersetzt keine verbindliche steuerliche Beratung. Sie ist bewusst defensiv modelliert und macht unsichere Fälle sichtbar.
