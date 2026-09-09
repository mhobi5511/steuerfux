# Rechnungen, Forderungen und Zahlungseingänge

## Umsetzung und Datenstand

Untersucht wurden die vorhandenen Server Actions, Abfragen, Oberflächen, `supabase/schema.sql` und sämtliche einschlägigen Migrationen. Die produktive Supabase-Datenbank wurde weder abgefragt noch verändert. Ihre tatsächlich installierte Struktur konnte deshalb nicht direkt verifiziert werden. Es wurden keine historischen Rechnungen, Einnahmen, Zahlungen oder Gebühren umgeschrieben, gelöscht oder automatisch zugeordnet.

Vorher existierten bereits `invoices`, `invoice_payments`, `incomes` und `bank_fees`. Beim E-Mail-Versand wurde eine offene Einnahme mit Zahlungseingang null erzeugt. Ein Trigger erlaubte nur eine Einnahme je Rechnung. Die Zahlungsaktion überschrieb diese Einnahme mit kumulierten Beträgen und dem jeweils letzten Zahlungsdatum/Kurs; Zahlung, Einnahme, Gebühr und Status waren separate Schreibvorgänge. Stornierungen löschten Einnahmen und Gebühren. Das Dashboard summierte zwar Zahlungseingänge statt Rechnungsbeträgen für den Gewinn, verwendete aber Rechnungsdaten für die zeitliche Zuordnung und addierte offene Rechnungsbeträge unterschiedlicher Währungen.

## Neuer Ablauf

1. **Ausstellen:** Die Rechnung selbst ist die Forderung. Ausstellen und Versenden erzeugen keine Einnahme. Entwürfe und Stornierungen zählen nicht zu offenen Forderungen.
2. **Zahlung:** `record_invoice_payment_v1` sperrt Buchhaltung/Rechnung und speichert eine Zahlung, genau eine eigene bezahlte Einnahme, einen gegebenenfalls bestätigten Gebührenausgleich und den daraus berechneten Status in einer PostgreSQL-Transaktion.
3. **Teilzahlung:** CHF 800 auf CHF 2’000 ergibt CHF 800 Einnahme und CHF 1’200 Rest. Weitere CHF 1’200 erzeugen eine zweite Einnahme. Die erste Zahlung bleibt unverändert.
4. **Idempotenz:** Pro Benutzer eindeutige `request_id`; pro neuer Zahlung eindeutige `income_id`; pro Einnahme eindeutige `invoice_payment_id`. Eine verzögerte Prüfung bei Transaktionsabschluss kontrolliert beide Seiten einschließlich Benutzer, Buchhaltung, Rechnung, Datum, Währung und Betrag. Wiederholungen werden vor der Statusprüfung erkannt. Ein erwarteter Saldo verhindert eine zweite Buchung aus einem veralteten Formular. Der Browser speichert einen unbestätigten Auftrag vor dem Senden und verwendet ihn nach Neuladen erneut.
5. **Status:** Rest = Rechnungssumme − Zahlungssumme − ausdrücklich erfasste Abzüge. Zahlungen werden in ganzen Rappen/Cent gerechnet. Die bestehende Datenbankbezeichnung `Teilweise bezahlt` bleibt erhalten; die Oberfläche zeigt `Teilbezahlt`. Überzahlungen werden vollständig gespeichert und separat ausgewiesen; keine Kappung am Rechnungsbetrag.
6. **Währungen:** Jede Zahlung erfolgt in Rechnungswährung. Die vorhandene historische CHF/EUR-Abfrage verwendet das Zahlungsdatum. EUR→CHF verwendet den Kehrwert. Kurs, Quelle, manuelle Bestätigung und Berichtsbetrag werden fest gespeichert. Ohne verfügbaren Kurs ist eine ausdrückliche manuelle Eingabe erforderlich. Eine Zahlung in einer anderen Währung als der Rechnungswährung wird abgewiesen, damit keine ungeklärte Umrechnung den Rechnungssaldo verändert.
7. **Abzüge:** Bei EUR 1’000 Rechnung, EUR 990 Empfang und EUR 10 begründetem Abzug bleiben EUR 990 tatsächlicher Eingang und EUR 10 separater Ausgleich sichtbar. Die vorhandene Gebührenart `Zahlungsdifferenz aus Einnahme` wird wiederverwendet. Neue bereits vom Empfang abgezogene Gebühren werden in der Cash-/Gewinnberechnung nicht ein zweites Mal abgezogen; historische Gebühren behalten ihre vorhandene Behandlung.
8. **Stornieren:** Erfordert Bestätigung und erfolgt unter derselben Rechnungssperre. Unbezahlte Rechnungen werden nur auf `Storniert` gesetzt. Bei Zahlungen oder unklaren Altbuchungen wird die Stornierung zur separaten buchhalterischen Klärung gesperrt. Keine automatische Rückbuchung. Stornierte Rechnungen stehen in einer standardmäßig geschlossenen, durchsuchbaren Sektion mit PDF-Zugriff.
9. **Oberfläche:** Zahlungsdialog mit Datum heute, Rechnungswährung und vorgeschlagenem Restbetrag; Übersicht mit bezahlt/offen/Ausgleich/Überzahlung; Zahlungshistorie auch für Teilzahlungen. Verknüpfte Einnahmen sind im allgemeinen Einnahmeneditor geschützt. Historische offene Einnahmezeilen bleiben in einer separaten historischen Sektion sichtbar.
10. **Dashboard/Export:** Tatsächliche Einnahmen werden anhand des Zahlungsdatums dem Jahr/Monat zugeordnet. Offene Rechnungen umfassen auch Vorjahresrechnungen, die bis zum ausgewählten Jahr ausgestellt wurden. Die Forderungsanzeige zeigt den aktuellen Zustand, keinen rekonstruierten historischen Jahresendstand. CHF-/EUR-Forderungen werden separat gezeigt; nur Forderungen in Berichtswährung fließen in die entsprechend beschriftete Berichtswährungssumme ein. Datenbankfehler werden nicht als leere Finanzsummen dargestellt. Einnahmen, Rechnungen und Zahlungshistorien werden seitenweise vollständig geladen.

## Manuell in Supabase ausführen

Optional zuerst die ausschließlich lesende Prüfung:

`supabase/checks/invoice_workflow_preflight.sql`

Die **einzige neue Migration**, die für diesen Ablauf auszuführen ist:

`supabase/migrations/202609090001_atomic_invoice_payments.sql`

Den vollständigen Inhalt im SQL Editor des richtigen Supabase-Projekts ausführen. Die Datei enthält ihre eigene Transaktion und kann erneut ausgeführt werden. Nicht stattdessen `schema.sql` oder alte Migrationen erneut ausführen: ältere Dateien enthalten historische Datenbereinigungen und destruktive Anweisungen.

Die Migration ergänzt nullable Verknüpfungs-/Snapshotspalten, partielle eindeutige Indizes, Funktionen, Schutztrigger und zusätzliche restriktive RLS-Regeln. Der vorhandene Einnahmen-Duplikatwächter wird so erweitert, dass alte Forderungen weiterhin ihre bisherige Einschränkung behalten und neue Zahlungseinnahmen über ihren eigenen eindeutigen Schlüssel verknüpft werden. Es gibt keinen Daten-Backfill, keine nachträgliche Finanzdatenberechnung und kein Löschen/Entfernen von Tabellen, Spalten oder bestehenden Richtlinien. Die enthaltenen INSERT-/UPDATE-Anweisungen stehen in den später ausdrücklich aufgerufenen Workflow-Funktionen; die Migration selbst führt sie nicht auf Buchungsdaten aus.

Die neue App-Version benötigt diese Migration für Zahlung/Stornierung. Fehlt sie, gibt es eine Fehlermeldung und keinen Rückfall auf mehrstufige Schreiboperationen. Es wurde keine Migration auf Produktion ausgeführt und keine Veröffentlichung vorgenommen.

## Bewusst unveränderter Altbestand

- Alte Zahlungen ohne neuen Anfrage-Schlüssel werden nicht automatisch mit Einnahmen verheiratet. Zusätzliche Zahlungen auf solche Rechnungen sind bis zur manuellen Abstimmung gesperrt.
- Historisch aggregierte Einnahmen werden nicht nachträglich auf frühere Zahlungstage/Kurse aufgeteilt. Deren ursprüngliche Einzelzuordnung lässt sich aus dem alten Modell nicht zuverlässig rekonstruieren.
- Alte offene Rechnungseinnahmen bleiben gespeichert, werden bei Forderungssummen aber nicht zusätzlich zur Rechnung gezählt. Ein eindeutig unbezahlter solcher Eintrag verhindert neue, separat verknüpfte Zahlungseinnahmen nicht.
- Ein abweichender alter `paid_total_cents`-Saldo oder widersprüchliche Status-/Zahlungsdaten wird nicht automatisch korrigiert. Die Übersicht kennzeichnet erkennbare Abstimmungsfälle; die Datenbank prüft zusätzlich alte Einnahmeverknüpfungen.
- Deutschland und Schweiz bleiben über `user_id`, `buchhaltung_id` und `invoice_id` getrennt. Geschlossene Buchhaltungen bleiben schreibgeschützt. Berichtswährung wird serverseitig aus der Buchhaltung gelesen und gegen das Land geprüft.

## Prüfung

Ergebnis der lokalen Prüfung: `npm run typecheck`, `npm run lint`, alle **32 Tests** aus `npm test` und `npm run build` erfolgreich. Der Produktionsbuild einschließlich `verify-invoice-pdf-build.mjs` besteht; die vorhandenen PDF-Schrift-/React-Prüfungen bleiben erfolgreich.

`tests/invoice-workflow.test.ts` verwendet ausschließlich eine neue lokale PGlite/PostgreSQL-Instanz mit erfundenen Benutzern und Buchungen. Grundlage ist das konsolidierte Repository-Schema plus die vorhandenen August-/September-Migrationen. Alte Migrationen werden nur in dieser isolierten Testdatenbank angewendet. Supabase-URLs und Zugangsdaten werden nicht verwendet.

Geprüft werden: tatsächliches Ausstellen ohne Einnahme; CHF 2’000 → CHF 800 → CHF 1’200; identische Wiederholungen und geänderte Nutzlast; veralteter Saldo; vollständiger Rollback bei injiziertem Fehler nach Erstellung der Einnahme; Stornierung mit/ohne Zahlung; Bestätigungspflicht; DE/CH und Benutzerisolation; abgeschlossene Buchhaltung; historische FX-Snapshots; Gebühren genau einmal; Überzahlung; ungültige Angaben; RLS-Umgehungsversuche; unveränderliche Zahlung/Einnahme/Gebühr/Rechnungsposition; verwaiste Einnahme; Wiederholung der Migration; Erhalt alter Forderungszeilen; mehr als 1’000 Datensätze und Fehler auf Folgeseiten.

Die Testumgebung prüft echtes PostgreSQL-Verhalten, aber keine parallelen unabhängigen PostgreSQL-Sitzungen oder produktive Supabase-/Browser-Netzwerkbedingungen. Die Sperrung konkurrierender Schreibvorgänge ist im RPC explizit implementiert. Kein Ende-zu-Ende-Zahlungstest wurde an realen Buchhaltungsdaten ausgeführt.

Technische Referenzen: [PostgreSQL Row Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [PGlite API](https://pglite.dev/docs/api).
