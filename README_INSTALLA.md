# Fanta Random MVP — installazione e uso

Web app personale per asta Fantacalcio **Classic full random**.

## Cosa fa

- carica il listone Classic 2026/27 al primo avvio;
- assegna automaticamente le fasce **S / A / B / C / D** per ruolo;
- cerca rapidamente il giocatore estratto;
- `Venduto`: lo rimuove dai disponibili;
- `Mio`: registra il tuo acquisto e il prezzo;
- mostra solo **i tuoi** crediti, slot, rosa e Max Bid;
- mostra il radar dei giocatori ancora disponibili per ruolo/fascia;
- permette di segnare target personali con ★;
- include il listone nel progetto, senza dipendere da GitHub durante l'uso;
- permette backup/ripristino;
- permette il **Reset asta** senza perdere configurazione, fasce e preferiti.

Non gestisce crediti, rose, slot o budget degli avversari.

## Fasce gestite dall'app

Le fasce non sono quelle ufficiali di Fantacalcio: sono una classificazione strategica dell'MVP basata sull'ordine FVM all'interno di ogni ruolo.

- **S** — Top
- **A** — Prima fascia
- **B** — Buoni titolari
- **C** — Rotazione
- **D** — Scommesse / riempitivi

La fascia S è volutamente selettiva: P 6, D 12, C 12, A 8.

## Listone

La fonte di riferimento è il **Listone ufficiale Fantacalcio 2026/27 Classic**:

https://www.fantacalcio.it/quotazioni-fantacalcio

Il download ufficiale Excel richiede il flusso del sito/app. L'app include una copia strutturata pubblica che dichiara come fonte le quotazioni Fantacalcio.it e contiene ruolo Classic, squadra, quotazione e FVM. L'app filtra i giocatori marcati come non più attivi e salva poi il listone nel browser.

Prima dell'asta puoi premere **Impostazioni → Aggiorna**. Il file locale viene usato per primo; le sorgenti online restano disponibili come fallback.

## Configurazione consigliata

Apri **Impostazioni** e inserisci:

- nome squadra;
- **budget asta** (es. 500);
- offerta minima (normalmente 1);
- slot P / D / C / A secondo la vostra lega.

Il **Max Bid** viene calcolato così:

`crediti residui - crediti minimi necessari per completare tutti gli altri slot`

Esempio: 150 crediti, 5 slot da completare, offerta minima 1 → Max Bid = 146.

## Reset asta

`Impostazioni → Reset asta`

Il reset:

- rimette tutti i giocatori come disponibili;
- cancella la tua rosa e i prezzi registrati;
- riporta i crediti al budget iniziale;
- azzera lo storico `Annulla`;
- **mantiene** budget, slot, nome squadra, listone, fasce e preferiti ★.

È utile per fare una simulazione prima dell'asta e ripartire puliti il giorno vero.

## Pubblicazione gratuita con GitHub Pages

1. Crea un repository GitHub, ad esempio `fanta-random`.
2. Carica **tutto il contenuto di questa cartella** nella root del repository, inclusa `.github`.
3. Assicurati che il branch principale si chiami `main`.
4. In GitHub vai in **Settings → Pages**.
5. In `Build and deployment` scegli **GitHub Actions**.
6. Il workflow incluso pubblicherà automaticamente la web app.
7. Apri su iPhone l'indirizzo GitHub Pages generato.
8. Lascia che il listone venga caricato almeno una volta mentre sei online.
9. In Safari: **Condividi → Aggiungi alla schermata Home**.

Da quel momento `Fanta Random` si apre come una normale app e i dati dell'asta rimangono sul telefono.

## Prima dell'asta

Fai questa prova una volta:

1. imposta il budget;
2. verifica che il listone mostri centinaia di giocatori;
3. cerca 2-3 nomi noti;
4. segna uno come `Venduto`;
5. compra un giocatore con `Mio` e verifica crediti/Max Bid;
6. prova `↶ Annulla`;
7. prova `Reset asta`;
8. chiudi e riapri l'app per verificare che configurazione e asta siano state salvate.
