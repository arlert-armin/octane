import { Connection, Transaction, Keypair } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
import { Cache } from 'cache-manager';

export async function validateAccountInitializationInstructions(
    connection: Connection,
    originalTransaction: Transaction,
    feePayer: Keypair,
    cache: Cache
): Promise<void> {
    const transaction = Transaction.from(originalTransaction.serialize({ requireAllSignatures: false }));

    // Find the associated-token-account creation instruction. We don't require a
    // fixed instruction count/position: wallets (e.g. Phantom) inject ComputeBudget
    // and Lighthouse guard instructions, and the fee transfer is validated
    // separately by validateTransfer.
    const instruction = transaction.instructions.find((ix) =>
        ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)
    );
    if (!instruction) {
        throw new Error('transaction must contain an associated token account creation');
    }

    const [payerMeta, ataMeta, ownerMeta, mintMeta] = instruction.keys;
    const associatedToken = await getAssociatedTokenAddress(mintMeta.pubkey, ownerMeta.pubkey);

    // Check if account isn't already created
    if (await connection.getAccountInfo(associatedToken, 'confirmed')) {
        throw new Error('account already exists');
    }

    // Verify the payer is the fee payer (Octane) and the created account is the
    // correct ATA. We check meaningful fields directly instead of
    // areInstructionsEqual, which breaks across spl-token versions (rent sysvar).
    if (!payerMeta.pubkey.equals(feePayer.publicKey)) {
        throw new Error('account init payer must be the fee payer');
    }
    if (!ataMeta.pubkey.equals(associatedToken)) {
        throw new Error('account init creates the wrong associated token account');
    }

    // Anti-drain: the fee payer must not be writable/signer in any OTHER
    // instruction (only legitimately so as the ATA-creation rent payer above).
    for (const ix of transaction.instructions) {
        if (ix === instruction) continue;
        for (const key of ix.keys) {
            if ((key.isWritable || key.isSigner) && key.pubkey.equals(feePayer.publicKey)) {
                throw new Error('fee payer must not be used by other instructions');
            }
        }
    }

    // Prevent creating the same account too many times within a short timeframe (per one recent blockhash)
    const key = `account/${transaction.recentBlockhash}_${associatedToken.toString()}`;
    if (await cache.get(key)) throw new Error('duplicate account within same recent blockhash');
    await cache.set(key, true);
}
