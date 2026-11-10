# Wealth First: Business-Puffer-Ziel und Investitionsüberschuss

## Fachliche Änderung

Der bisherige Wert `wealth_first_settings.warning_threshold_cents` wird für neue Verteilungen als echtes **Business-Puffer-Ziel** verwendet. Der technische Spaltenname bleibt zur Kompatibilität erhalten. Bestehende konfigurierte Werte werden nicht überschrieben; neue Einrichtungen beginnen weiterhin mit CHF 4'500. Das Speichern eines Zielbetrags ändert weder den Puffer noch abgeschlossene Verteilungen.

Die Monatsziele und ihre Reihenfolge bleiben unverändert: Steuerrücklage auf neue Eingänge, Servicekonto, Kautionsfonds, Guilt Free, ETF-Investitionen, privater Notgroschen. Erst anschließend wird der Puffer bis zu seinem Ziel aufgefüllt. Der Rest ist **Überschuss für zusätzliche Investitionen**, unabhängig vom monatlichen ETF-Ziel. Ein neuer Spartopf oder eine Vermögensverwaltung wird nicht angelegt.

Nach den Monatszuweisungen gilt in ganzen Rappen:

```text
Neue Eingänge = Bankstand − bisheriger Puffer − bisher offener Überschuss
Verteilbar = Bankstand − bisher offener Überschuss − neue Steuerrücklage
Rest = Verteilbar − aktuelle Monatszuweisungen
Neuer Puffer = min(Rest, Puffer-Ziel)
Neuer Investitionsüberschuss = Rest − neuer Puffer
Verfügbarer Überschuss = bisher offener Überschuss + neuer Investitionsüberschuss
```

Die bestehende automatische Prioritätsverteilung begrenzt die Monatszuweisungen auf die verteilbaren Mittel. Daher sind Rest und Puffer niemals negativ. Ein Zielunterschreiten informiert über den exakten Abstand zum Ziel und blockiert keine Verteilung.

Die Beispiele ergeben CHF 4'500 Puffer plus CHF 1'215 Überschuss im starken Monat bzw. CHF 2'715 Puffer und CHF 0 Überschuss im schwachen Monat.

Liegt der **bisher gespeicherte** Puffer bereits über dem Ziel, wird er durch eine Einstellungsänderung oder Vorschau nicht reduziert. Soll bei einer neuen Verteilung ein verbleibender Überhang zu Überschuss werden, muss der Benutzer das ausdrücklich freigeben. Ohne Freigabe lehnen Client und Server die Bestätigung ab.

## Manuelle Überweisungen und offener Überschuss

Für eine neue Verteilung wird der tatsächliche Bankstand **vor** den dort aufgeführten Überweisungen eingegeben. Die Verteilungsbestätigung bestätigt wie bisher die manuell ausgeführten Steuer-, Servicekonto- und Spartopfüberweisungen. Die App führt keine Überweisung aus.

Der zusätzliche Überschuss ist standardmäßig **nicht als überwiesen bestätigt**. Er bleibt separat in `pending_surplus_cents` gespeichert. Nur eine ausdrückliche zusätzliche Bestätigung setzt die im Lauf enthaltene Überschussüberweisung auf den gesamten verfügbaren Überschuss. Diese Bestätigung bezieht sich auf eine Überweisung **nach Erfassung des eingegebenen Bankstands**. Änderungen an Bankstand, Datum oder Zuweisungen löschen die Bestätigung in der Vorschau wieder.

Eine bereits früher ausgeführte Überschussüberweisung wird vor dem nächsten Bankstand separat protokolliert. Das kann vollständig oder als Teilbetrag erfolgen. Dafür gibt es `settle_wealth_first_surplus_v1` und eine kleine aufklappbare Oberfläche beim offenen Überschuss. Ein anderer tatsächlicher Abgang kann mit einer Begründung als Abstimmung protokolliert werden; dabei wird keine Investitionsüberweisung behauptet und keine buchhalterische Ausgabe erzeugt.

Die späteren Abgänge werden unveränderlich in `wealth_first_surplus_settlements` gespeichert. Sie ändern nur den aktuellen offenen Überschuss und die Versionsnummer, niemals den Puffer oder einen abgeschlossenen Verteilungssnapshot. Der ursprüngliche Status in der Historie heißt deshalb ausdrücklich „Bei Bestätigung noch offen“; spätere Abgänge stehen daneben als eigene Ereignisse.

Solange Überschuss noch offen ist, wird er bei neuen Verteilungen vom Bankstand abgezogen und weder nochmals versteuert noch erneut in Monatsziele verteilt. Ein Bankstand unter Puffer plus offenem Überschuss verlangt eine Abstimmung. Die bisherige allgemeine Puffer-Abstimmung darf offenen Überschuss nicht zum Puffer erklären und wird deshalb solange blockiert. Zuerst muss ein tatsächlich erfolgter Überschuss-Abgang separat bestätigt oder begründet abgestimmt werden. Liegt der Überschuss weiterhin auf dem Konto, kann er offen bleiben und der normale Verteilungsablauf weiterverwendet werden.

Der exakte Bankabgleich lautet:

```text
Eingegebener Bankstand
= Steuerrücklage
+ Servicekonto- und Spartopfzuweisungen
+ ausdrücklich bestätigte Überschussüberweisung
+ neuer reservierter Business-Puffer
+ danach noch offener Überschuss
```

## Datenbank und manuelle Bereitstellung

Erforderliche Reihenfolge, jeweils nur soweit noch nicht ausgeführt:

1. `supabase/migrations/202610260001_wealth_first.sql`
2. `supabase/migrations/202611100001_wealth_first_service_dates.sql`
3. `supabase/migrations/202611100002_wealth_first_buffer_target.sql`
4. `supabase/migrations/202611100003_wealth_first_transfer_accounts.sql`

**Diese Dateien wurden nicht gegen die Produktionsdatenbank ausgeführt.** Sie müssen manuell geprüft und eingespielt werden. Die aktualisierte App benötigt alle vier Migrationen. Bei bestehenden Einrichtungen bleiben die einmalige Servicekonto- und Zielkonto-Zuordnung in den Einstellungen erforderlich.

Die neue Migration ergänzt nullable Snapshot-Spalten, einen aktuellen offenen Überschuss und dessen Ereignistabelle. Sie enthält keine historische Rückbefüllung und keine Datenkorrektur. Weil drei vorhandene CHECK-Gleichungen jeden verbleibenden Centime ausschließlich als Puffer behandeln, werden genau diese drei CHECK-Constraints innerhalb derselben Transaktion unter Tabellensperre durch erweiterte Gleichungen ersetzt. Das ist die technisch erforderliche Anpassung der bestehenden Integritätsprüfungen; es werden keine Tabellen, Spalten, Finanzwerte, Eigentumsregeln oder Eindeutigkeitsschlüssel entfernt. Für historische Zeilen bleiben die neuen Felder NULL, sodass dort mathematisch exakt die ursprünglichen Gleichungen gelten. Zusätzliche CHECKs sichern Zielbegrenzung, Überschuss und Status neuer Snapshots. Die Migration ist wiederholbar.

`confirm_wealth_first_distribution_v2` wird gezielt mit `CREATE OR REPLACE FUNCTION` erweitert. Name, PostgreSQL-Signatur, Funktionsidentität und Berechtigungen bleiben erhalten. Es gibt keine neue parallele Bestätigungs-RPC. Der vorhandene JSON-Parameter akzeptiert nun ein Objekt mit Zuweisungsliste und den beiden ausdrücklichen Bestätigungen. Alte Array-Anfragen bleiben für unveränderte Wiederholungen historischer Bestätigungen kompatibel; neue Läufe mit Überschuss verlangen die aktuelle Oberfläche.

Die Bestätigungs-RPC berechnet Steuerreserve, Prioritätszuweisungen, Zielpuffer, Überschuss und Bankabgleich selbst. Sie verwendet weiterhin die exklusive Einstellungszeilensperre, Versionsprüfung, Eigentum und Buchhaltung, eindeutige Anfrage-Schlüssel und Inhaltsvergleich. Die beiden neuen Bestätigungen gehören zum Inhaltsvergleich. Separates Abgangsprotokollieren sperrt dieselbe Einstellungszeile und erhöht dieselbe Versionsnummer. Dadurch kann ein alter Vorschlag offenen Überschuss nicht doppelt berücksichtigen. Rückdatierungen vor spätere Verteilungen oder Abstimmungen werden abgelehnt.

Bestehende RLS, Unveränderlichkeitstrigger und Eigentums-Fremdschlüssel bleiben bestehen. Die neue Ereignistabelle übernimmt dieselben Regeln; direkte Schreibrechte sind gesperrt. Rechnungen, Einnahmen, Ausgaben, Zahlungen und steuerliche Berechnungen werden nicht berührt.

## Prüfungen und Grenzen

Die bisherigen 70 Tests bleiben erhalten; Berechnungsbegriffe und eine frühere Erwartung für einen bereits über dem Ziel liegenden Puffer wurden an die korrigierte Regel angepasst. `tests/wealth-first-buffer-target.test.ts` ergänzt die starken und schwachen Monate, Nullziel, Teilziele, Monatsrest, offene/teilweise/bestätigte Überweisungen, Freigabe vorhandener Überhänge, Einstellungshistorie, Upgrade mit vorhandenen Daten, unveränderte Funktionsidentität, RLS, direkte Constraint-Verstöße, Wiederholungen und atomare Rollbacks.

Lokale Prüfung: `npm run typecheck`, `npm run lint` und `npm test` erfolgreich; alle 86 Tests bestanden. Der Produktionsbuild einschließlich PDF-Nachprüfung wurde ebenfalls erfolgreich ausgeführt.

SQL-Tests laufen ausschließlich in PostgreSQL/PGlite im Arbeitsspeicher ohne Supabase-Verbindung. Konkurrierende Anfragen werden dort an dieselbe Instanz gestellt; ein separater Lasttest mit mehreren echten Datenbankverbindungen ist nicht Bestandteil dieser lokalen Prüfung. Die tatsächliche Bankausführung kann die App nicht prüfen und setzt die ausdrückliche Benutzerbestätigung voraus.

Geänderte Bereiche: `src/lib/wealth-first.ts`, `src/lib/wealth-first-data.ts`, `src/lib/db-types.ts`, `src/app/actions/wealth-first.ts`, `src/components/wealth-first/wealth-first-module.tsx`, `src/app/(protected)/wealth-first/page.tsx`, die vorhandenen Wealth-First-Tests, der neue Regressionstest und diese Folge-Migration. Die beiden vorherigen Migrationen bleiben unverändert.
