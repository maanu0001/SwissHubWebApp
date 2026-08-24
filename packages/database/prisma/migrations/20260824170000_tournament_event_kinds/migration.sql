-- Zwei Ereignisarten, die bisher gefehlt haben.
--
-- Die Anmeldung eines Mitglieds wurde als REGISTRATION_APPROVED gefuehrt und
-- der Check-in als CHECKIN_OPENED. Im Turnierverlauf las sich das, als haetten
-- Mitglieder ihre eigene Anmeldung freigegeben und die Check-in-Phase
-- eroeffnet. Beides sind Handlungen der Turnierleitung - hier bekommen die
-- Handlungen der Teilnehmer ihre eigenen Namen.
--
-- Rein additiv: bestehende Eintraege behalten ihren Wert.
ALTER TYPE "TournamentEventKind" ADD VALUE IF NOT EXISTS 'REGISTERED';
ALTER TYPE "TournamentEventKind" ADD VALUE IF NOT EXISTS 'CHECKED_IN';
