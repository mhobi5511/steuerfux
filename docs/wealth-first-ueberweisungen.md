# Wealth First: Überweisungsübersicht

Unmittelbar vor dem Abschluss zeigt Schritt 6 eine schreibgeschützte Übersicht der **aktuellen** Verteilung nach Zielkonto. Sie speichert nichts und verändert weder Monatszuweisungen noch Business-Puffer. Erst „Verteilung abschliessen“ ruft weiterhin die bestehende atomare Bestätigung auf.

Standardzuordnung für neue Einrichtungen:

| Zuweisung | Zielkonto |
| --- | --- |
| Steuerrücklage | GLKB Steuerkonto |
| Servicekonto | GLKB Servicekonto |
| Guilt Free | Revolut |
| Kautionsfonds | Yuh |
| ETF-Investitionen | Yuh |
| Privater Notgroschen | Yuh |

Die Zielkonten sind stabile interne Schlüssel und in den Wealth-First-Einstellungen editierbar. Bei einer bestehenden Einrichtung schlägt die Oberfläche diese Werte vor; sie werden erst beim Speichern als Konfiguration übernommen. Umbenennen eines Topfs ändert eine gespeicherte Zuordnung nicht. Änderungen der Zuordnung betreffen keine abgeschlossenen Verteilungen oder Finanzwerte.

Die Tabelle gruppiert ausschließlich positive, aktuelle Beträge. Yuh wird einmal angezeigt und enthält darunter die einzelnen Topfbeträge. Teilbeträge erscheinen mit ihrem tatsächlichen Rappenbetrag; bereits im Monat finanzierte Ziele erscheinen mit CHF 0 nicht erneut. Die Gesamtsumme enthält Steuern, Servicekonto und Spartöpfe. Zusätzlicher Investitionsüberschuss steht separat als noch nicht zugeordnet und ist ausdrücklich nicht Teil dieser Summe. „Kopieren“ kopiert den unformatierten Betrag mit zwei Dezimalstellen für die Banking-App.

Manuell einspielen, nach den drei vorhandenen Wealth-First-Migrationen:

`supabase/migrations/202611100003_wealth_first_transfer_accounts.sql`

Die Migration ergänzt nur zwei konfigurierbare Felder und `save_wealth_first_settings_v3`. Sie schreibt keine bestehenden Einstellungen oder Verteilungen, erzeugt keine Bankbewegung und ändert keine RLS-, Bestätigungs- oder Berechnungslogik. Die vorherige Settings-RPC wird anschließend für direkte Clientaufrufe gesperrt, damit Zielkonten nicht umgangen werden können.
