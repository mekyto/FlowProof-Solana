let connectedWallet = null;

const API_URL = "http://localhost:3000";
const MEMO_PROGRAM_ID = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";


/* =========================
   HELPERS
========================= */

function getElement(id) {
    return document.getElementById(id);
}


function escapeHTML(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function shortenWallet(address) {
    if (!address) {
        return "";
    }

    if (address.length <= 10) {
        return address;
    }

    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}


function getPhantomProvider() {
    if (window.phantom?.solana?.isPhantom) {
        return window.phantom.solana;
    }

    if (window.solana?.isPhantom) {
        return window.solana;
    }

    return null;
}


/* =========================
   CHECK SOLANA
========================= */

function setNetworkState(online, label) {
    const network = document.querySelector(".network");
    const heroText = getElement("heroStatusText");
    const heroDot = document.querySelector(".status-dot");

    if (network) {
        network.innerHTML = `<span class="network-dot ${online ? "" : "offline"}"></span>${label}`;
    }

    if (heroText) {
        heroText.textContent = online ? "Network operational" : "Network offline";
    }

    if (heroDot) {
        heroDot.classList.toggle("offline", !online);
    }
}


async function checkSolana() {
    try {
        const response = await fetch(`${API_URL}/api/solana`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        setNetworkState(Boolean(data.success), data.success ? "Solana Devnet" : "Solana Offline");

    } catch (error) {
        console.error("Solana error:", error);
        setNetworkState(false, "Backend Offline");
    }
}


/* =========================
   CONNECT PHANTOM
========================= */

async function connectWallet() {
    const provider = getPhantomProvider();

    if (!provider) {
        alert("Phantom wallet was not found. Please install Phantom.");
        return;
    }

    try {
        const response = await provider.connect();

        if (!response?.publicKey) {
            throw new Error("Public key was not returned.");
        }

        connectedWallet = response.publicKey.toString();

        const button = getElement("walletButton");

        if (button) {
            button.textContent = shortenWallet(connectedWallet);
            button.classList.add("connected");
        }

        console.log("Wallet connected:", connectedWallet);

    } catch (error) {
        console.error("Wallet connection error:", error);

        if (error?.code === 4001) {
            alert("Wallet connection was rejected.");
        } else {
            alert("Could not connect Phantom wallet.");
        }
    }
}


/* =========================
   VERIFY INVOICE
========================= */

async function verifyInvoice() {
    const invoiceId = getElement("invoiceId")?.value.trim();
    const sender = getElement("sender")?.value.trim();
    const receiver = getElement("receiver")?.value.trim();
    const amount = getElement("amount")?.value;
    const currency = getElement("currency")?.value;
    const description = getElement("description")?.value.trim();

    if (!invoiceId || !sender || !receiver || !amount) {
        alert("Please fill in all required fields.");
        return;
    }

    const numericAmount = Number(amount);

    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
        alert("Amount must be greater than 0.");
        return;
    }
    if (numericAmount > 1e12) {
    alert("Amount is too large.");
    return;
}

    try {
        const response = await fetch(`${API_URL}/api/verify`, {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                invoiceId,
                sender,
                receiver,
                amount: numericAmount,
                currency,
                description,
                private: Boolean(getElement("privateMode")?.checked)
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            alert(
                data.message ||
                "Could not create proof."
            );

            return;
        }

        showProof(data.proof);

        if (data.proof?.risk) {
            getElement("result").insertAdjacentHTML("beforeend", riskBlock(data.proof.risk));
        }

        if (data.salt) {
            getElement("result").insertAdjacentHTML("beforeend", `<div class="proof-item"><div class="proof-label">Salt (save it, required for checking)</div><div class="hash">${escapeHTML(data.salt)}</div></div>`);
        }

        loadDashboard();

    }  catch (error) {
    console.error("VERIFY ERROR:", error);
    alert(`Error: ${error.message}`);
    }
}


/* =========================
   ANCHOR BLOCK
========================= */

function anchorBlock(proof, target) {
    const blockchain = proof.blockchain || {};

    if (blockchain.onChain) {
        return `
            <div class="proof-item">
                <a
                    href="https://explorer.solana.com/tx/${escapeHTML(blockchain.transaction)}?cluster=devnet"
                    target="_blank"
                    rel="noopener">
                    View on Explorer ↗
                </a>
            </div>
        `;
    }

    return `
        <button
            class="primary-action"
            type="button"
            onclick="anchorProof('${escapeHTML(proof.proofId)}', '${target}')">
            Anchor on Solana
            <span class="arrow">→</span>
        </button>
    `;
}


/* =========================
   SHOW PROOF
========================= */

function showProof(proof) {
    const result = getElement("result");

    if (!result || !proof) {
        return;
    }

    const invoice = proof.invoice || {};
    const blockchain = proof.blockchain || {};

    const onChainStatus = blockchain.onChain
        ? "✓ Stored on-chain"
        : "Not yet stored on-chain";

    result.className = "proof-result";

    result.innerHTML = `
        <span class="status">
            ✓ VERIFIED
        </span>

        <div class="proof-item">
            <div class="proof-label">
                Proof ID
            </div>

            <strong>
                ${escapeHTML(proof.proofId)}
            </strong>
        </div>

        <div class="proof-item">
            <div class="proof-label">
                Invoice
            </div>

            ${escapeHTML(invoice.invoiceId)}
        </div>

        <div class="proof-item">
            <div class="proof-label">
                Amount
            </div>

            ${escapeHTML(invoice.amount)}
            ${escapeHTML(invoice.currency)}
        </div>

        <div class="proof-item">
            <div class="proof-label">
                Sender
            </div>

            ${escapeHTML(invoice.sender)}
        </div>

        <div class="proof-item">
            <div class="proof-label">
                Receiver
            </div>

            ${escapeHTML(invoice.receiver)}
        </div>

        <div class="proof-item">
            <div class="proof-label">
                SHA-256
            </div>

            <div class="hash">
                ${escapeHTML(proof.invoiceHash)}
            </div>
        </div>

        <div class="proof-item">
            <div class="proof-label">
                Blockchain
            </div>

            ${escapeHTML(
                blockchain.network || "Solana Devnet"
            )}
        </div>

        <div class="proof-item">
            <div class="proof-label">
                On-chain status
            </div>

            ${onChainStatus}
        </div>

        ${anchorBlock(proof, "result")}
    `;
}


/* =========================
   FIND PROOF
========================= */

async function findProof() {
    const input = getElement("searchProofId");
    const result = getElement("foundProof");

    if (!input || !result) {
        return;
    }

    const proofId = input.value.trim();

    if (!proofId) {
        alert("Enter a Proof ID.");
        return;
    }

    result.innerHTML = `
        <div class="card">
            <p>Searching for proof...</p>
        </div>
    `;

    try {
        const response = await fetch(
            `${API_URL}/api/proof/${encodeURIComponent(proofId)}`
        );

        const data = await response.json();

        if (
            !response.ok ||
            !data.success ||
            !data.proof
        ) {
            result.innerHTML = `
                <div class="card">
                    <p class="error">
                        Proof not found.
                    </p>
                </div>
            `;

            return;
        }

        const proof = data.proof;
        const invoice = proof.invoice || {};
        const blockchain = proof.blockchain || {};

        const status =
            proof.status || "VERIFIED";

        const onChainStatus = blockchain.onChain
            ? "✓ Stored on-chain"
            : "Not yet stored on-chain";

        result.innerHTML = `
            <div class="card">

                <div class="card-top">

                    <div>
                        <span class="card-kicker">
                            VERIFICATION RECORD
                        </span>

                        <h3>
                            Proof Found
                        </h3>
                    </div>

                    <span class="status">
                        ✓ ${escapeHTML(status)}
                    </span>

                </div>


                <div class="proof-item">
                    <div class="proof-label">
                        Proof ID
                    </div>

                    <strong>
                        ${escapeHTML(proof.proofId)}
                    </strong>
                </div>


                <div class="proof-item">
                    <div class="proof-label">
                        Invoice
                    </div>

                    ${escapeHTML(invoice.invoiceId)}
                </div>


                <div class="proof-item">
                    <div class="proof-label">
                        Sender
                    </div>

                    ${escapeHTML(invoice.sender)}
                </div>


                <div class="proof-item">
                    <div class="proof-label">
                        Receiver
                    </div>

                    ${escapeHTML(invoice.receiver)}
                </div>


                <div class="proof-item">
                    <div class="proof-label">
                        Amount
                    </div>

                    ${escapeHTML(invoice.amount)}
                    ${escapeHTML(invoice.currency)}
                </div>


                <div class="proof-item">
                    <div class="proof-label">
                        SHA-256
                    </div>

                    <div class="hash">
                        ${escapeHTML(proof.invoiceHash)}
                    </div>
                </div>


                <div class="proof-item">
                    <div class="proof-label">
                        Blockchain
                    </div>

                    ${escapeHTML(
                        blockchain.network ||
                        "Solana Devnet"
                    )}
                </div>


                <div class="proof-item">
                    <div class="proof-label">
                        On-chain status
                    </div>

                    ${onChainStatus}
                </div>

                ${anchorBlock(proof, "found")}

            </div>
        `;

    } catch (error) {
        console.error("Search error:", error);

        result.innerHTML = `
            <div class="card">
                <p class="error">
                    Could not connect to FlowProof backend.
                </p>
            </div>
        `;
    }
}
async function checkDocument() {
    const result = getElement("checkResult");
    const proofId = getElement("checkProofId").value.trim();
    const amount = Number(getElement("checkAmount").value);

    if (!proofId || !getElement("checkInvoiceId").value.trim()) {
        alert("Enter Proof ID and invoice data.");
        return;
    }

    if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
        alert("Enter a valid amount.");
        return;
    }

    result.innerHTML = `<div class="card"><p>Checking...</p></div>`;

    try {
        const response = await fetch(`${API_URL}/api/check-proof`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                proofId,
                salt: getElement("checkSalt").value.trim(),
                invoice: {
                    invoiceId: getElement("checkInvoiceId").value,
                    sender: getElement("checkSender").value,
                    receiver: getElement("checkReceiver").value,
                    amount,
                    currency: getElement("checkCurrency").value,
                    description: getElement("checkDescription").value
                }
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            result.innerHTML = `<div class="card"><p class="error">${escapeHTML(data.message || "Check failed.")}</p></div>`;
            return;
        }

        const original = data.originalInvoice;
const current = data.currentInvoice;

if (!original || !current) {
    console.error("Invalid backend response:", data);

    result.innerHTML = `
        <div class="card">
            <p class="error">
                Backend returned incomplete proof data.
            </p>
        </div>
    `;

    return;
}

const changed = Object.keys(original).filter(
    key => original[key] !== current[key]
);

        result.innerHTML = `
            <div class="card">
                <div class="card-top">
                    <div>
                        <span class="card-kicker">INTEGRITY CHECK</span>
                        <h3>${data.verified ? "Document is authentic" : "Document was modified"}</h3>
                    </div>
                    <span class="status">${data.verified ? "✓ MATCH" : "✗ MISMATCH"}</span>
                </div>
                ${changed.map(key => `
                    <div class="proof-item">
                        <div class="proof-label">${escapeHTML(key)}</div>
                        ${escapeHTML(original[key])} → ${escapeHTML(current[key])}
                    </div>
                `).join("")}
                <div class="proof-item">
                    <div class="proof-label">Original hash</div>
                    <div class="hash">${escapeHTML(data.originalHash)}</div>
                </div>
                <div class="proof-item">
                    <div class="proof-label">Current hash</div>
                    <div class="hash">${escapeHTML(data.currentHash)}</div>
                </div>
            </div>
        `;

    } catch (error) {
        console.error("Check error:", error);
        result.innerHTML = `<div class="card"><p class="error">Could not connect to FlowProof backend.</p></div>`;
    }
}


/* =========================
   ANCHOR PROOF
========================= */

async function anchorProof(proofId, target) {
    const provider = getPhantomProvider();

    if (!provider || !connectedWallet) {
        alert("Connect Phantom first.");
        return;
    }

    if (!window.solanaWeb3) {
        alert("Solana library failed to load.");
        return;
    }

    try {
        const proofResponse = await fetch(
            `${API_URL}/api/proof/${encodeURIComponent(proofId)}`
        );

        const proofData = await proofResponse.json();

        if (!proofResponse.ok || !proofData.success) {
            alert("Proof not found.");
            return;
        }

        const {
            Connection,
            PublicKey,
            Transaction,
            TransactionInstruction,
            SystemProgram,
            clusterApiUrl
        } = solanaWeb3;

        const connection = new Connection(
            clusterApiUrl("devnet"),
            "confirmed"
        );

        const issuer = new PublicKey(connectedWallet);

        const programId = new PublicKey(
            "HZ1EBuiSJeW2MRS8pvD7r5fTJoCRPgWDyE9Ei2EnPZ5b"
        );

        // Invoice hash from backend
        const invoiceHash = proofData.proof.invoiceHash;

        if (!/^[0-9a-fA-F]{64}$/.test(invoiceHash)) {
            alert("Invalid invoice hash.");
            return;
        }

        // Convert SHA-256 hex string -> 32 bytes
        const hashBytes = new Uint8Array(32);

        for (let i = 0; i < 32; i++) {
            hashBytes[i] = parseInt(
                invoiceHash.slice(i * 2, i * 2 + 2),
                16
            );
        }

        /*
         * PDA:
         * seeds = ["proof", issuer, invoice_hash]
         */
        const [proofPda] = PublicKey.findProgramAddressSync(
            [
                new TextEncoder().encode("proof"),
                issuer.toBytes(),
                hashBytes
            ],
            programId
        );

        /*
         * The Anchor instruction discriminator is:
         * sha256("global:create_proof")[0..8]
         *
         * We calculate it manually because the frontend
         * does not use @coral-xyz/anchor.
         */
        async function sha256Bytes(message) {
            const encoded = new TextEncoder().encode(message);
            const hashBuffer = await crypto.subtle.digest(
                "SHA-256",
                encoded
            );
            return new Uint8Array(hashBuffer);
        }

        const discriminator = (
            await sha256Bytes("global:create_proof")
        ).slice(0, 8);

        /*
         * create_proof arguments:
         *
         * invoice_hash: [u8; 32]
         * amount: u64
         * discount_bps: u16
         * risk_score: u8
         * due_at: i64
         */

        const amount = Number(proofData.proof.invoice.amount);

        if (!Number.isFinite(amount) || amount <= 0) {
            alert("Invalid invoice amount.");
            return;
        }

        // USDC uses 6 decimals.
        // For USD/USDC invoice amounts:
        const amountAtomic = BigInt(
            Math.round(amount * 1_000_000)
        );

        const riskScore = Math.max(
            0,
            Math.min(
                100,
                Number(proofData.proof.risk?.score || 0)
            )
        );

        // Same pricing logic as backend
        const discountBps = Math.min(
            5000,
            200 + 20 * riskScore
        );

        // 30 days from now
        const dueAt = BigInt(
            Math.floor(Date.now() / 1000) +
            30 * 24 * 60 * 60
        );

        /*
         * Encode little-endian integers.
         */
        const data = new Uint8Array(
            8 +       // discriminator
            32 +      // invoice_hash
            8 +       // amount u64
            2 +       // discount_bps u16
            1 +       // risk_score u8
            8         // due_at i64
        );

        let offset = 0;

        // discriminator
        data.set(discriminator, offset);
        offset += 8;

        // invoice_hash
        data.set(hashBytes, offset);
        offset += 32;

        // amount u64 LE
        const amountView = new DataView(
            data.buffer,
            data.byteOffset + offset,
            8
        );

        amountView.setBigUint64(
            0,
            amountAtomic,
            true
        );

        offset += 8;

        // discount_bps u16 LE
        const discountView = new DataView(
            data.buffer,
            data.byteOffset + offset,
            2
        );

        discountView.setUint16(
            0,
            discountBps,
            true
        );

        offset += 2;

        // risk_score u8
        data[offset] = riskScore;
        offset += 1;

        // due_at i64 LE
        const dueView = new DataView(
            data.buffer,
            data.byteOffset + offset,
            8
        );

        dueView.setBigInt64(
            0,
            dueAt,
            true
        );

        /*
         * Anchor create_proof accounts:
         *
         * proof
         * issuer
         * payer
         * mint
         * system_program
         *
         * IMPORTANT:
         * payer and mint are required by the Anchor program.
         */

        const payer = issuer;

        const usdcMint = new PublicKey(
            "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        );

        const instruction = new TransactionInstruction({
            programId,
            keys: [
                {
                    pubkey: proofPda,
                    isSigner: false,
                    isWritable: true
                },
                {
                    pubkey: issuer,
                    isSigner: true,
                    isWritable: true
                },
                {
                    pubkey: payer,
                    isSigner: false,
                    isWritable: false
                },
                {
                    pubkey: usdcMint,
                    isSigner: false,
                    isWritable: false
                },
                {
                    pubkey: SystemProgram.programId,
                    isSigner: false,
                    isWritable: false
                }
            ],
            data
        });

        const transaction = new Transaction();

        transaction.add(instruction);

        transaction.feePayer = issuer;

        const {
            blockhash,
            lastValidBlockHeight
        } = await connection.getLatestBlockhash("confirmed");

        transaction.recentBlockhash = blockhash;

        console.log("FlowProof Anchor create_proof:", {
            proofId,
            programId: programId.toString(),
            proofPda: proofPda.toString(),
            issuer: issuer.toString(),
            payer: payer.toString(),
            mint: usdcMint.toString(),
            amount,
            amountAtomic: amountAtomic.toString(),
            riskScore,
            discountBps,
            dueAt: dueAt.toString()
        });

        /*
         * Phantom signs the REAL Anchor transaction.
         */
        const signedTransaction =
            await provider.signTransaction(transaction);

        const signature =
            await connection.sendRawTransaction(
                signedTransaction.serialize()
            );

        await connection.confirmTransaction(
            {
                signature,
                blockhash,
                lastValidBlockHeight
            },
            "confirmed"
        );

        console.log(
            "Anchor create_proof confirmed:",
            signature
        );

        /*
         * Verify the PDA account exists and belongs
         * to our FlowProof program.
         */
        const accountInfo =
            await connection.getAccountInfo(proofPda);

        if (!accountInfo) {
            throw new Error(
                "Anchor transaction succeeded, but Proof PDA was not found."
            );
        }

        if (!accountInfo.owner.equals(programId)) {
            throw new Error(
                "Proof PDA exists, but it is not owned by FlowProof program."
            );
        }

        /*
         * Tell backend to save the on-chain transaction.
         */
        const response = await fetch(`${API_URL}/api/anchor`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                proofId,
                signature,
                pda: proofPda.toString()
            })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            alert(
                result.message ||
                "On-chain proof created, but backend update failed."
            );
            return;
        }

        /*
         * Sync DeFi state.
         */
        try {
            await fetch(`${API_URL}/api/defi/sync`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    proofId,
                    pda: proofPda.toString()
                })
            });
        } catch (syncError) {
            console.warn(
                "DeFi sync failed:",
                syncError
            );
        }

        if (target) {
            target.innerHTML = `
                <div class="success">
                    <strong>Proof anchored on Solana.</strong>
                    <div>
                        PDA:
                        <code>${proofPda.toString()}</code>
                    </div>
                    <div>
                        Transaction:
                        <code>${signature}</code>
                    </div>
                </div>
            `;
        }

        alert(
            `Proof anchored successfully!\n\nPDA: ${proofPda.toString()}`
        );

    } catch (error) {
        console.error("Anchor error:", error);

        alert(
            error?.message ||
            "Failed to create on-chain proof."
        );
    }
}

/* =========================
   SEARCH ENTER KEY
========================= */

document.addEventListener("keydown", (event) => {
    if (
        event.key === "Enter" &&
        document.activeElement?.id === "searchProofId"
    ) {
        findProof();
    }
});


/* =========================
   START APPLICATION
========================= */

document.addEventListener("DOMContentLoaded", () => {
    checkSolana();
    setInterval(checkSolana, 30000);
    setupWalletEvents();
});


async function loadDashboard() {
    const box = getElement("dashboard");

    if (!box) {
        return;
    }

    try {
        const [a, n] = await Promise.all([
            fetch(`${API_URL}/api/analytics`).then(r => r.json()),
            fetch(`${API_URL}/api/network`).then(r => r.json())
        ]);

        let balance = "—";

        if (connectedWallet && window.solanaWeb3) {
            const conn = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl("devnet"), "confirmed");
            const lamports = await conn.getBalance(new solanaWeb3.PublicKey(connectedWallet));
            balance = `${(lamports / 1e9).toFixed(3)} SOL`;
        }

        const t = a.totals;
        const kpis = [
            ["Proofs created", t.proofs],
            ["Anchored on-chain", `${t.anchored} (${t.anchorRate}%)`],
            ["Private proofs", t.private],
            ["Integrity checks", `${t.checks} / ${t.tampered} tampered`],
            ["Duplicate hashes", t.duplicates],
            ["Unique parties", t.uniqueParties],
            ["Solana slot", n.success ? n.slot.toLocaleString() : "—"],
            ["Network TPS", n.success && n.tps !== null ? n.tps : "—"],
            ["Wallet balance", balance],
            ["Financed volume", `${(a.defi?.financedVolume || 0).toLocaleString()} USDC`],
            ["Avg discount", `${((a.defi?.avgDiscountBps || 0) / 100).toFixed(2)}%`],
            ["Invoices listed / paid", `${a.defi?.listed || 0} / ${a.defi?.paid || 0}`]
        ];

        const dmax = Math.max(1, ...a.daily.map(d => d.count));
        const vmax = Math.max(1, ...a.volume.map(v => v.amount));

        box.innerHTML = `
            <div class="kpi-grid">
                ${kpis.map(([label, value]) => `
                    <div class="kpi">
                        <span>${escapeHTML(label)}</span>
                        <strong>${escapeHTML(value)}</strong>
                    </div>`).join("")}
            </div>

            <div class="dash-row">
                <div class="card">
                    <span class="card-kicker">PROOFS PER DAY</span>
                    <div class="bars">
                        ${a.daily.map(d => `
                            <div class="bar-col" title="${escapeHTML(d.day)}: ${d.count}">
                                <em>${d.count}</em>
                                <div class="bar" style="height:${Math.round(d.count / dmax * 100)}%"></div>
                                <small>${escapeHTML(d.day.slice(5))}</small>
                            </div>`).join("") || "<p>No data yet.</p>"}
                    </div>
                </div>

                <div class="card">
                    <span class="card-kicker">VOLUME BY CURRENCY (PUBLIC PROOFS)</span>
                    ${a.volume.map(v => `
                        <div class="hbar">
                            <div class="hbar-label">${escapeHTML(v.currency)} · ${v.count}</div>
                            <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(2, Math.round(v.amount / vmax * 100))}%"></div></div>
                            <div class="hbar-value">${escapeHTML(v.amount.toLocaleString())}</div>
                        </div>`).join("") || "<p>No data yet.</p>"}
                </div>
            </div>

            <div class="card">
                <span class="card-kicker">RECENT ACTIVITY</span>
                <div class="table-wrap">
                    <table class="activity">
                        <thead><tr><th>Proof</th><th>Invoice</th><th>Amount</th><th>Status</th><th>Created</th></tr></thead>
                        <tbody>
                            ${a.recent.map(r => `
                                <tr>
                                    <td>${escapeHTML(r.proofId)}</td>
                                    <td>${escapeHTML(r.invoiceId)}</td>
                                    <td>${r.private ? "🔒 hidden" : `${escapeHTML(r.amount)} ${escapeHTML(r.currency)}`}</td>
                                    <td>${r.onChain ? `<a href="https://explorer.solana.com/tx/${escapeHTML(r.transaction)}?cluster=devnet" target="_blank" rel="noopener">On-chain ↗</a>` : "Off-chain"}</td>
                                    <td>${escapeHTML(new Date(r.createdAt).toLocaleString())}</td>
                                </tr>`).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

    } catch (error) {
        console.error("Dashboard error:", error);
        box.innerHTML = `<div class="card"><p class="error">Analytics unavailable.</p></div>`;
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadDashboard();
    setInterval(loadDashboard, 15000);
});



function riskBlock(risk) {
    return `
        <div class="proof-item">
            <div class="proof-label">AI risk score</div>
            <span class="risk ${escapeHTML(risk.level)}">${escapeHTML(risk.score)}/100 · ${escapeHTML(risk.level.toUpperCase())}</span>
            ${risk.flags.map(f => `<div>⚠ ${escapeHTML(f)}</div>`).join("")}
        </div>`;
}


function readFileB64(file) {
    return new Promise(resolve => {
        if (!file) {
            return resolve(null);
        }

        const reader = new FileReader();
        reader.onload = () => resolve({ mediaType: file.type, data: String(reader.result).split(",")[1] });
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
    });
}


async function collectInput(textId, fileId) {
    let text = getElement(textId).value.trim();
    const picked = getElement(fileId).files[0];

    if (picked && (picked.type.startsWith("text/") || /\.(txt|md|csv|json)$/i.test(picked.name))) {
        text = (text + "\n" + (await picked.text())).trim().slice(0, 50000);
        return { text, file: null };
    }

    return { text, file: await readFileB64(picked) };
}


async function aiIntake() {
    const out = getElement("aiIntakeResult");
    const { text, file } = await collectInput("aiText", "aiFile");

    if (!text && !file) {
        alert("Paste invoice text or attach a file.");
        return;
    }

    out.innerHTML = `<p>AI is reading the invoice...</p>`;

    try {
        const response = await fetch(`${API_URL}/api/ai/extract`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, file })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            out.innerHTML = `<p class="error">${escapeHTML(data.message || "AI request failed.")}</p>`;
            return;
        }

        const invoice = data.invoice;

        ["invoiceId", "sender", "receiver", "amount", "description"].forEach(key => {
            getElement(key).value = invoice[key] ?? "";
        });

        const currency = getElement("currency");

        if (invoice.currency && ![...currency.options].some(o => o.value === invoice.currency)) {
            currency.add(new Option(invoice.currency, invoice.currency));
        }

        currency.value = invoice.currency;

        const clean = data.confidence >= 0.8 && !data.warnings.length;

        out.innerHTML = `
            <div class="proof-item"><div class="proof-label">AI confidence</div>${Math.round(data.confidence * 100)}%</div>
            ${data.warnings.map(w => `<div class="proof-item">⚠ ${escapeHTML(w)}</div>`).join("")}
            <p>${clean ? "Clean extraction, creating proof..." : "Review the fields below, then press Generate Proof."}</p>`;

        if (clean) {
            await verifyInvoice();
        }

    } catch (error) {
        console.error("AI intake error:", error);
        out.innerHTML = `<p class="error">Could not reach the FlowProof backend.</p>`;
    }
}


async function aiAutoCheck() {
    const result = getElement("checkResult");
    const { text, file } = await collectInput("aiCheckText", "aiCheckFile");

    if (!text && !file) {
        alert("Paste invoice text or attach a file.");
        return;
    }

    result.innerHTML = `<div class="card"><p>AI is checking the document...</p></div>`;

    try {
        const response = await fetch(`${API_URL}/api/ai/auto-check`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, file, salt: getElement("checkSalt").value.trim() })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            result.innerHTML = `<div class="card"><p class="error">${escapeHTML(data.message || "AI request failed.")}</p></div>`;
            return;
        }

        result.innerHTML = `
            <div class="card">
                <div class="card-top">
                    <div>
                        <span class="card-kicker">AI AUTO-CHECK</span>
                        <h3>${data.verified ? "Document is authentic" : data.proofId ? "Document was modified" : "No proof found"}</h3>
                    </div>
                    <span class="status">${data.verified ? "✓ MATCH" : "✗ MISMATCH"}</span>
                </div>
                ${data.proofId ? `<div class="proof-item"><div class="proof-label">Matched proof</div>${escapeHTML(data.proofId)}</div>` : ""}
                ${data.diffs.map(d => `
                    <div class="proof-item">
                        <div class="proof-label">${escapeHTML(d.field)}</div>
                        ${escapeHTML(d.original)} → ${escapeHTML(d.current)}
                    </div>`).join("")}
                ${data.warnings.map(w => `<div class="proof-item">⚠ ${escapeHTML(w)}</div>`).join("")}
            </div>`;

        loadDashboard();

    } catch (error) {
        console.error("Auto-check error:", error);
        result.innerHTML = `<div class="card"><p class="error">Could not reach the FlowProof backend.</p></div>`;
    }
}


async function loadInsights() {
    const box = getElement("aiInsights");
    box.innerHTML = `<p>AI is analyzing...</p>`;

    try {
        const response = await fetch(`${API_URL}/api/ai/insights`, { method: "POST" });
        const data = await response.json();

        if (!response.ok || !data.success) {
            box.innerHTML = `<p class="error">${escapeHTML(data.message || "AI request failed.")}</p>`;
            return;
        }

        box.innerHTML = `<div class="insights">${escapeHTML(data.insights).replace(/\n/g, "<br>")}</div>`;

    } catch (error) {
        box.innerHTML = `<p class="error">Could not reach the FlowProof backend.</p>`;
    }
}


async function loadIntel() {
    const box = getElement("intel");

    if (!box) {
        return;
    }

    try {
        const a = await fetch(`${API_URL}/api/analytics`).then(r => r.json());
        const rk = a.risk;
        const rt = Math.max(1, rk.low + rk.medium + rk.high);
        const series = [
            ...a.daily.map(d => ({ day: d.day.slice(5), v: d.count, p: false })),
            ...a.forecast.map(d => ({ day: d.day.slice(5), v: d.count, p: true }))
        ];
        const smax = Math.max(1, ...series.map(s => s.v));
        const hmax = Math.max(1, ...a.hourly);
        const conc = a.concentration < 1500 ? "Diversified" : a.concentration < 2500 ? "Moderate" : "Concentrated";

        box.innerHTML = `
            <div class="dash-row">
                <div class="card">
                    <span class="card-kicker">RISK DISTRIBUTION · AVG ${rk.avg}/100</span>
                    <div class="stack">
                        <i class="low" style="width:${rk.low / rt * 100}%"></i>
                        <i class="medium" style="width:${rk.medium / rt * 100}%"></i>
                        <i class="high" style="width:${rk.high / rt * 100}%"></i>
                    </div>
                    <div class="legend">Low ${rk.low} · Medium ${rk.medium} · High ${rk.high}</div>
                    ${a.topRisk.map(r => `
                        <div class="proof-item">
                            <span class="risk ${escapeHTML(r.level)}">${escapeHTML(r.score)}</span>
                            ${escapeHTML(r.proofId)} · ${escapeHTML(r.invoiceId)}
                            <div class="legend">${escapeHTML(r.flags.join(" · "))}</div>
                        </div>`).join("")}
                </div>

                <div class="card">
                    <span class="card-kicker">ACTIVITY FORECAST · TREND ${a.trendPerDay >= 0 ? "+" : ""}${a.trendPerDay}/DAY</span>
                    <div class="bars">
                        ${series.map(s => `
                            <div class="bar-col" title="${escapeHTML(s.day)}: ${s.v}${s.p ? " (forecast)" : ""}">
                                <em>${s.v}</em>
                                <div class="bar ${s.p ? "predicted" : ""}" style="height:${Math.round(s.v / smax * 100)}%"></div>
                                <small>${escapeHTML(s.day)}</small>
                            </div>`).join("")}
                    </div>
                </div>
            </div>

            <div class="dash-row">
                <div class="card">
                    <span class="card-kicker">COUNTERPARTY CONCENTRATION · ${conc.toUpperCase()} (HHI ${a.concentration})</span>
                    ${a.counterparties.map(c => `
                        <div class="hbar">
                            <div class="hbar-label" title="${escapeHTML(c.name)}">${escapeHTML(shortenWallet(c.name) || c.name)}</div>
                            <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(2, c.share)}%"></div></div>
                            <div class="hbar-value">${c.share}%</div>
                        </div>`).join("") || "<p>No data yet.</p>"}
                </div>

                <div class="card">
                    <span class="card-kicker">ACTIVITY BY HOUR (UTC)</span>
                    <div class="bars short">
                        ${a.hourly.map((v, h) => `
                            <div class="bar-col" title="${h}:00 · ${v}">
                                <div class="bar" style="height:${Math.round(v / hmax * 100)}%"></div>
                                <small>${h % 6 === 0 ? h : ""}</small>
                            </div>`).join("")}
                    </div>
                </div>
            </div>

            <div class="card">
                <span class="card-kicker">AMOUNT DISTRIBUTION BY CURRENCY</span>
                <div class="table-wrap">
                    <table class="activity">
                        <thead><tr><th>Currency</th><th>Proofs</th><th>Mean</th><th>Median</th><th>P90</th><th>Max</th></tr></thead>
                        <tbody>
                            ${a.amountStats.map(s => `
                                <tr>
                                    <td>${escapeHTML(s.currency)}</td>
                                    <td>${s.n}</td>
                                    <td>${escapeHTML(Math.round(s.mean).toLocaleString())}</td>
                                    <td>${escapeHTML(Math.round(s.median).toLocaleString())}</td>
                                    <td>${escapeHTML(Math.round(s.p90).toLocaleString())}</td>
                                    <td>${escapeHTML(Math.round(s.max).toLocaleString())}</td>
                                </tr>`).join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `;

    } catch (error) {
        console.error("Intel error:", error);
        box.innerHTML = `<div class="card"><p class="error">Intelligence data unavailable.</p></div>`;
    }
}


const assistantHistory = [];

function toggleAssistant() {
    getElement("assistantPanel").classList.toggle("open");
}

function addMessage(role, text) {
    const box = getElement("assistantMessages");
    box.insertAdjacentHTML("beforeend", `<div class="msg ${role}">${escapeHTML(text).replace(/\n/g, "<br>")}</div>`);
    box.scrollTop = box.scrollHeight;
}

function sendPrompt(text) {
    getElement("assistantInput").value = text;
    sendAssistant();
}

async function sendAssistant() {
    const input = getElement("assistantInput");
    const message = input.value.trim();

    if (!message) {
        return;
    }

    input.value = "";
    addMessage("user", message);
    addMessage("assistant", "…");

    const box = getElement("assistantMessages");

    try {
        const response = await fetch(`${API_URL}/api/ai/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message, history: assistantHistory })
        });

        const data = await response.json();
        box.lastElementChild.remove();

        if (!response.ok || !data.success) {
            addMessage("assistant", data.message || "AI request failed.");
            return;
        }

        addMessage("assistant", data.reply);
        assistantHistory.push({ role: "user", content: message }, { role: "assistant", content: data.reply });

        if (data.created) {
            loadDashboard();
            loadIntel();
        }

    } catch (error) {
        box.lastElementChild.remove();
        addMessage("assistant", "Could not reach the FlowProof backend.");
    }
}

document.addEventListener("DOMContentLoaded", () => {
    loadIntel();
    setInterval(loadIntel, 15000);
});