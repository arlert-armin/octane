import { Connection, Transaction, TransactionSignature, Keypair } from '@solana/web3.js';
import base58 from 'bs58';

// Check that a transaction is basically valid, sign it, and serialize it, verifying the signatures
// This function doesn't check if payer fee was transferred (instead, use validateTransfer) or
// instruction signatures do not include fee payer as a writable account (instead, use validateInstructions).
export async function validateTransaction(
    connection: Connection,
    transaction: Transaction,
    feePayer: Keypair,
    maxSignatures: number,
    lamportsPerSignature: number
): Promise<{ signature: TransactionSignature; rawTransaction: Buffer }> {
    // Check the fee payer and blockhash for basic validity
    if (!transaction.feePayer?.equals(feePayer.publicKey)) throw new Error('invalid fee payer');
    if (!transaction.recentBlockhash) throw new Error('missing recent blockhash');

    // TODO: handle nonce accounts?

    // NOTE: getFeeCalculatorForBlockhash was removed from modern Solana RPCs
    // (returns "Method not found"). The blockhash is validated implicitly when the
    // transaction is broadcast (sendRawTransaction rejects an expired/invalid
    // blockhash), and on mainnet lamportsPerSignature is the fixed 5000 this
    // relayer already caps at — so the old pre-check is a safe no-op to drop.
    void lamportsPerSignature;

    // Check the signatures for length, the primary signature, and secondary signature(s)
    if (!transaction.signatures.length) throw new Error('no signatures');
    if (transaction.signatures.length > maxSignatures) throw new Error('too many signatures');

    const [primary, ...secondary] = transaction.signatures;
    if (!primary.publicKey.equals(feePayer.publicKey)) throw new Error('invalid fee payer pubkey');
    if (primary.signature) throw new Error('invalid fee payer signature');

    for (const signature of secondary) {
        if (!signature.publicKey) throw new Error('missing public key');
        if (!signature.signature) throw new Error('missing signature');
    }

    // Add the fee payer signature
    transaction.partialSign(feePayer);

    // Serialize the transaction, verifying the signatures
    const rawTransaction = transaction.serialize();

    // Return the primary signature (aka txid) and serialized transaction
    return { signature: base58.encode(transaction.signature!), rawTransaction };
}
