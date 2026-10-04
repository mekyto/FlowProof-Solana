const DEFI = { config: null, market: {} };

const TOKEN_PROGRAM = new solanaWeb3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = new solanaWeb3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");


function walletProvider() {
    return window.phantom?.solana || window.solana;
}


function concatBytes(...parts) {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;

    parts.forEach(p => {
        out.set(p, offset);
        offset += p.length;
    });

    return out;
}


function leInt(value, size, signed) {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);

    if (size === 8) {
        signed ? view.setBigInt64(0, BigInt(value), true) : view.setBigUint64(0, BigInt(value), true);
    } else {
        view.setUint16(0, value, true);
    }

    return bytes;
}


function hexToBytes(hex) {
    return Uint8Array.from(hex.match(/../g).map(h => parseInt(h, 16)));
}


async function anchorDiscriminator(name) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`global:${name}`));
    return new Uint8Array(hash).slice(0, 8);
}


function findAta(owner, mint) {
    return solanaWeb3.PublicKey.findProgramAddressSync(
        [owner.toBytes(), TOKEN_PROGRAM.toBytes(), mint.toBytes()],
        ATA_PROGRAM
    )[0];
}


function createAtaIx(payer, owner, mint) {
    return new solanaWeb3.TransactionInstruction({
        programId: ATA_PROGRAM,
        keys: [
            { pubkey: payer, isSigner: true, isWritable: true },
            { pubkey: findAta(owner, mint), isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: false, isWritable: false },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false }
        ],
        data: Uint8Array.of(1)
    });
}


function showDefi(html) {
    getElement("defiResult").innerHTML = `<div class="card">${html}</div>`;
}


function explorerLink(signature) {
    return `<a href="https://explorer.solana.com/tx/${escapeHTML(signature)}?cluster=devnet" target="_blank" rel="noopener">View transaction ↗</a>`;
}


async function defiConfig() {
    if (!DEFI.config) {
        DEFI.config = await fetch(`${API_URL}/api/defi/config`).then(r => r.json());
    }

    if (!DEFI.config.programId) {
        throw new Error("Backend has no FLOWPROOF_PROGRAM_ID. Deploy the program and set it in API.env.");
    }

    return DEFI.config;
}


function requireWallet() {
    const provider = walletProvider();

    if (!provider?.publicKey) {
        throw new Error("Connect Phantom first.");
    }

    return provider;
}


async function sendDefiTx(instructions) {
    const provider = requireWallet();
    const connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl("devnet"), "confirmed");
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new solanaWeb3.Transaction({ feePayer: provider.publicKey, blockhash, lastValidBlockHeight });

    instructions.forEach(ix => tx.add(ix));

    const { signature } = await provider.signAndSendTransaction(tx);
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");

    return signature;
}


async function syncDefi(proofId, pda) {
    const response = await fetch(`${API_URL}/api/defi/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proofId, pda })
    });

    const data = await response.json();

    if (!data.success) {
        throw new Error(data.message || "Sync failed");
    }

    return data.defi;
}


async function quoteDefi() {
    const proofId = getElement("defiProofId").value.trim();

    if (!proofId) {
        alert("Enter a Proof ID.");
        return;
    }

    const q = await fetch(`${API_URL}/api/defi/quote/${encodeURIComponent(proofId)}`).then(r => r.json());

    if (!q.success) {
        showDefi(`<p class="error">${escapeHTML(q.message)}</p>`);
        return;
    }

    if (!q.eligible) {
        showDefi(`<h3>Not eligible</h3><p>${escapeHTML(q.reason)}</p>`);
        return;
    }

    if (q.payerWallet && !getElement("defiPayer").value.trim()) {
        getElement("defiPayer").value = q.payerWallet;
    }

    showDefi(`
        <span class="card-kicker">FINANCING QUOTE</span>
        <div class="proof-item"><div class="proof-label">Invoice amount</div>${(q.amountBase / 1e6).toLocaleString()} USDC</div>
        <div class="proof-item"><div class="proof-label">Advance to issuer</div>${(q.advanceBase / 1e6).toLocaleString()} USDC</div>
        <div class="proof-item"><div class="proof-label">Discount (priced from AI risk score ${escapeHTML(q.riskScore)}/100)</div>${(q.discountBps / 100).toFixed(2)}%</div>
        <div class="proof-item"><div class="proof-label">Investor yield</div>${escapeHTML(q.yieldPct)}%</div>
    `);
}


async function publishDefi() {
    try {
        const proofId = getElement("defiProofId").value.trim();

        if (!proofId) {
            showDefi(`<p class="error">Enter the proof ID.</p>`);
            return;
        }

        const provider = requireWallet();

        const response = await fetch(
            `${API_URL}/api/proof/${encodeURIComponent(proofId)}`
        );

        const data = await response.json();

        if (!data.success || !data.proof || !data.proof.defi) {
            throw new Error("This proof is not available for DeFi.");
        }

        const d = data.proof.defi;

        if (d.status !== "Open") {
            throw new Error(`Proof cannot be listed. Current status: ${d.status}`);
        }

        if (d.issuer !== provider.publicKey.toBase58()) {
            throw new Error("Only the invoice issuer can publish this proof.");
        }

        await syncDefi(proofId, d.pda);

        showDefi(`
            <h3>Published for financing</h3>
            <p>Proof is already on-chain and is now available in the DeFi marketplace.</p>
            <p>PDA: ${escapeHTML(d.pda)}</p>
        `);

        loadMarket();
        loadDashboard();

    } catch (error) {
        console.error("Publish error:", error);
        showDefi(`<p class="error">${escapeHTML(error.message)}</p>`);
    }
}

async function loadMarket() {
    const box = getElement("defiMarket");

    if (!box) {
        return;
    }

    try {
        const data = await fetch(`${API_URL}/api/defi/market`).then(r => r.json());
        DEFI.market = {};
        data.items.forEach(item => { DEFI.market[item.proofId] = item; });

        box.innerHTML = data.items.map(item => `
            <div class="market-item">
                <div>
                    <strong>${escapeHTML(item.proofId)} · ${escapeHTML(item.invoiceId)}</strong>
                    <div class="market-meta">
                        Fund ${item.advance.toLocaleString()} USDC → receive ${item.amount.toLocaleString()} USDC ·
                        yield ${escapeHTML(item.yieldPct)}% ·
                        <span class="risk ${item.riskScore >= 55 ? "high" : item.riskScore >= 25 ? "medium" : "low"}">risk ${escapeHTML(item.riskScore)}</span> ·
                        due ${escapeHTML(new Date(item.dueAt * 1000).toLocaleDateString())}
                    </div>
                </div>
                <button type="button" onclick="fundDefi('${escapeHTML(item.proofId)}')">Fund</button>
            </div>`).join("") || "<p>No open invoices yet. Publish one as an issuer.</p>";

    } catch (error) {
        box.innerHTML = `<p class="error">Marketplace unavailable.</p>`;
    }
}


async function fundDefi(proofId) {
    try {
        const cfg = await defiConfig();
        const provider = requireWallet();
        const item = DEFI.market[proofId];

        if (!item) {
            throw new Error("Invoice is no longer open.");
        }

        const programId = new solanaWeb3.PublicKey(cfg.programId);
        const mint = new solanaWeb3.PublicKey(cfg.usdcMint);
        const issuer = new solanaWeb3.PublicKey(item.issuer);
        const investor = provider.publicKey;

        const DEMO_INVESTOR =
            "3cFpgRpA33YqTzsVg9uwUjpHKCDTdxCqQs68FUCdtERF";

        if (investor.toBase58() !== DEMO_INVESTOR) {
            throw new Error(
                "Connect the Investor wallet to fund this invoice."
            );
        }

        const ix = new solanaWeb3.TransactionInstruction({
            programId,
            keys: [
                { pubkey: new solanaWeb3.PublicKey(item.pda), isSigner: false, isWritable: true },
                { pubkey: investor, isSigner: true, isWritable: false },
                { pubkey: findAta(investor, mint), isSigner: false, isWritable: true },
                { pubkey: findAta(issuer, mint), isSigner: false, isWritable: true },
                { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false }
            ],
            data: await anchorDiscriminator("fund")
        });

        const signature = await sendDefiTx([createAtaIx(investor, issuer, mint), ix]);
        await syncDefi(proofId, item.pda);

        showDefi(`<h3>Invoice funded</h3><p>${escapeHTML(item.advance)} USDC sent to the issuer. ${explorerLink(signature)}</p>`);
        loadMarket();
        loadDashboard();

    } catch (error) {
        console.error("Fund error:", error);
        showDefi(`<p class="error">${escapeHTML(error.message)}</p>`);
    }
}


async function payDefi() {
    try {
        const proofId = getElement("defiPayId").value.trim();
        const cfg = await defiConfig();
        const provider = requireWallet();
        const data = await fetch(`${API_URL}/api/proof/${encodeURIComponent(proofId)}`).then(r => r.json());

        if (!data.success || !data.proof.defi) {
            throw new Error("This proof is not published on-chain.");
        }

        const d = data.proof.defi;

        if (d.payer !== provider.publicKey.toBase58()) {
            throw new Error(
                "Only the invoice receiver/payer can pay this invoice."
            );
        }

        const programId = new solanaWeb3.PublicKey(cfg.programId);
        const mint = new solanaWeb3.PublicKey(cfg.usdcMint);
        const payer = provider.publicKey;
        const holder = new solanaWeb3.PublicKey(d.status === "Financed" ? d.investor : d.issuer);

        const ix = new solanaWeb3.TransactionInstruction({
            programId,
            keys: [
                { pubkey: new solanaWeb3.PublicKey(d.pda), isSigner: false, isWritable: true },
                { pubkey: payer, isSigner: true, isWritable: false },
                { pubkey: findAta(payer, mint), isSigner: false, isWritable: true },
                { pubkey: findAta(holder, mint), isSigner: false, isWritable: true },
                { pubkey: TOKEN_PROGRAM, isSigner: false, isWritable: false }
            ],
            data: await anchorDiscriminator("pay")
        });

        const signature = await sendDefiTx([createAtaIx(payer, holder, mint), ix]);
        await syncDefi(proofId, d.pda);

        showDefi(`<h3>Invoice paid</h3><p>${escapeHTML(d.amount / 1e6)} USDC settled to ${d.status === "Financed" ? "the investor" : "the issuer"}. ${explorerLink(signature)}</p>`);
        loadMarket();
        loadDashboard();

    } catch (error) {
        console.error("Pay error:", error);
        showDefi(`<p class="error">${escapeHTML(error.message)}</p>`);
    }
}


document.addEventListener("DOMContentLoaded", loadMarket);