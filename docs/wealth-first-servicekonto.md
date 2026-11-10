# Wealth First: Servicekonto und Verteilungsdatum

**Folgeänderung:** Die Pufferlogik wurde anschließend zum echten Zielbetrag mit separat geführtem Investitionsüberschuss erweitert. Für den aktuellen Stand und die vollständige Migrationsreihenfolge siehe [Business-Puffer-Ziel und Investitionsüberschuss](wealth-first-pufferziel.md). Die nachfolgende Beschreibung dokumentiert den vorherigen Servicekonto-/Datumsstand; insbesondere „Warnschwelle“ und unbegrenztes Auffüllen sind durch die Folgeänderung überholt.

Die Erweiterung verwendet die bestehenden Einstellungen, Ziele, Monatszuweisungen und unveränderlichen Verteilungssnapshots. Rechnungen, Einnahmen, Ausgaben, Zahlungen und steuerliche Berechnungen werden nicht geändert. Eine Servicekonto-Zuweisung dokumentiert eine manuelle interne Überweisung; sie erzeugt keine Buchung oder Banktransaktion.

## Manuelle Bereitstellung

1. Die vorhandene Basismigration `202610260001_wealth_first.sql` muss bereits eingespielt sein.
2. `supabase/migrations/202611100001_wealth_first_service_dates.sql` prüfen und **manuell** im Supabase SQL Editor ausführen. Die App führt keine Migration automatisch aus. Die Migration ergänzt nullable Spalten, einen eindeutigen Index und versionierte RPCs. Sie enthält keine Datenkorrektur, keine historische Rückbefüllung und keine Änderung bestehender Datensätze.
3. Die aktualisierte App bereitstellen. Die Migration sperrt die alten Einstellungen-/Bestätigungs-RPCs für direkte Clientaufrufe, damit sie die neuen Prüfungen nicht umgehen können. Während des Übergangs können alte Clients nicht mehr speichern.
4. Bei jeder bestehenden Schweizer CHF-Einrichtung einmal die Wealth-First-Einstellungen öffnen, Servicekonto zuordnen und speichern. Ein vorhandenes Servicekonto als bisherigen Zieleintrag auswählen. Dessen ID bleibt erhalten, damit bestätigte Monatszuweisungen weiterhin zählen. Ein namensgleicher Eintrag wird im Editor vorgeschlagen; die gespeicherte Klassifikation ist anschließend allein maßgeblich. Andernfalls wird ein neues Ziel mit CHF 40 vorgeschlagen. Das passiert ausdrücklich beim Speichern, nicht beim Lesen oder Migrieren. Wiederholtes Speichern erzeugt kein zweites Servicekonto.

Neue Einrichtungen erhalten folgende bearbeitbare Monatsziele: Servicekonto CHF 40, Kautionsfonds CHF 620, Guilt Free CHF 450, ETF-Investitionen CHF 750 und privater Notgroschen CHF 425. Gesamtsumme CHF 2'285. Das Servicekonto ist immer zuerst; für die übrigen Ziele gilt die gespeicherte Reihenfolge. Zum Aussetzen des Servicekontos kann dessen Monatsziel auf CHF 0 gesetzt werden.

## Berechnung und Alltag

Normalerweise genügen Datum, Bankstand, Prüfung und Bestätigung. Der 10. und 25. sind Datumsvorschläge im gewählten Monat; ein anderes Datum und zusätzliche Verteilungen sind möglich. Das tatsächliche Datum wird unabhängig vom Zielmonat und dem technischen Bestätigungszeitpunkt gespeichert. Es gibt keine zeitgesteuerte Bestätigung.

Der frühere Vorschlag übernahm offene Monatsziele vollständig, ohne das verfügbare Geld zu begrenzen. Dadurch konnte die Vorschau einen negativen Puffer ergeben; die bisherige Datenbankfunktion verweigerte solche Bestätigungen bereits.

Die neue Berechnung erfolgt in ganzen Rappen:

- Neue Eingänge = tatsächlicher Einnahmenkonto-Bankstand minus gespeicherter Business-Puffer. Ein negativer Unterschied verlangt zunächst eine ausdrückliche, protokollierte Abstimmung.
- Die Steuerrücklage wird nur auf diese neuen Eingänge berechnet und kaufmännisch gerundet. Der bestehende Puffer wird nicht erneut besteuert.
- Verteilbar sind der Bankstand abzüglich Steuerrücklage, einschließlich des bestehenden Puffers.
- In Prioritätsreihenfolge erhält jedes Ziel höchstens sein noch offenes Monatsziel und höchstens das verbleibende Geld.
- Manuelle Reduktionen oder Verschiebungen sind ausdrücklich möglich. Nachfolgende automatische Zuweisungen werden sofort neu berechnet. Überschreitungen sperren die Bestätigung. Zusätzliche Zuweisungen über das Monatsziel sind im neuen Ablauf nicht vorgesehen.
- Überschüsse bleiben als Business-Puffer im Einnahmenkonto. CHF 0 ist die Untergrenze; die konfigurierte Warnschwelle bleibt unverbindlich.

Beispiel: Bei CHF 378.12 für den Notgroschen bleiben CHF 46.88 offen. Die nächste Verteilung desselben Zielmonats finanziert nur diese CHF 46.88; bereits vollständig finanzierte Ziele einschließlich Servicekonto erhalten CHF 0. Offene Ziele sind keine buchhalterischen Schulden. Der neue Monat beginnt mit seinen eigenen Monatszielen.

## Transaktion und Historie

`confirm_wealth_first_distribution_v2` behält die exklusive Sperre der Einstellungszeile während der gesamten Transaktion bei. Sie prüft Besitzer, Buchhaltung, Aktivstatus, Version und erwarteten Puffer, berechnet Steuerrücklage und Prioritätsgrenzen selbst und berücksichtigt alle bestätigten Monatszuweisungen. Automatische Beträge müssen exakt passen; ausdrücklich markierte Reduktionen dürfen darunter liegen. Alle Überweisungen plus Restpuffer müssen exakt zum Bankstand passen. Verteilung, Zielsnapshots und Puffer werden gemeinsam gespeichert oder gemeinsam zurückgerollt.

Der eindeutige Anfrage-Schlüssel sowie der Vergleich des Anfrageinhalts einschließlich Datum und manueller Reduktionen machen Doppelklicks und Wiederholungen idempotent. Konkurrierende Aufrufe werden über dieselbe Einstellungszeile serialisiert; eine inzwischen veraltete Vorschau wird abgelehnt. Der eindeutige Servicekonto-Index verhindert mehrere klassifizierte Servicekonten je Benutzer und Buchhaltung.

Ein tatsächliches Datum vor einer gespeicherten Verteilung oder Puffer-Abstimmung wird abgelehnt. Für alte Verteilungen ohne tatsächliches Datum dient ausschließlich für diese Schutzprüfung der Schweizer Kalendertag der damaligen Bestätigung als konservative Grenze. Alte Datums- und Klassifikationsfelder bleiben NULL und werden als historisch nicht erfasst angezeigt. Es gibt keinen rückwirkenden Korrekturablauf und keine Neuberechnung alter Salden oder Snapshots.

RLS, zusammengesetzte Eigentums-Fremdschlüssel, Schreibsperren und Unveränderlichkeitstrigger bleiben bestehen. Der Datenlader liest die Verteilungshistorie seitenweise vollständig, damit Monatszuweisungen auch außerhalb der früheren 100-Einträge-Grenze korrekt zählen.

## Prüfung

`tests/wealth-first.test.ts` bleibt erhalten. `tests/wealth-first-service.test.ts` ergänzt Priorität, Standardzielsumme, Teilziele, Monatsrest, manuelle Reduktionen, Rappenabgleich, Datumsvalidierung sowie Transaktions-, Upgrade-, Eigentums-, Wiederholungs- und Historienprüfungen. SQL wird dafür ausschließlich in PGlite im Arbeitsspeicher ausgeführt, ohne Supabase-Verbindung. Gleichzeitige Anfragen werden dort über eine PostgreSQL-Instanz abgearbeitet; ein separater Lasttest mit mehreren echten Produktionsverbindungen wurde nicht durchgeführt.

Geänderte Produktdateien: `src/lib/wealth-first.ts`, `src/lib/wealth-first-data.ts`, `src/lib/db-types.ts`, `src/app/actions/wealth-first.ts`, `src/components/wealth-first/wealth-first-module.tsx`, `src/app/(protected)/wealth-first/page.tsx`. Hinzu kommen die additive Migration, die neuen Regressionstests und diese Anleitung.
