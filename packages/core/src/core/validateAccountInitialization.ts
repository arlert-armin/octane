import { ComputeBudgetProgram, Connection, Transaction, Keypair } from '@solana/web3.js';
import {
    ASSOCIATED_TOKEN_PROGRAM_ID,
    createAssociatedTokenAccountInstruction,
    getAssociatedTokenAddress,
} from '@solana/spl-token';
import { Cache } from 'cache-manager';
import { areInstructionsEqual } from './instructions';

export async function validateAccountInitializationInstructions(
    connection: Connection,
    originalTransaction: Transaction,
    feePayer: Keypair,
    cache: Cache
): Promise<void> {
    const transaction = Transaction.from(originalTransaction.serialize({ requireAllSignatures: false }));

    // Ignore ComputeBudget instructions that wallets (e.g. Phantom) may prepend.
    const instructions = transaction.instructions.filter(
        (ix) => !ix.programId.equals(ComputeBudgetProgram.programId)
    );

    // Instructions should be: [fee transfer, account initialization]
    // The fee transfer is validated with validateTransfer in the action function.
    if (instructions.length != 2) {
        throw new Error('transaction should contain 2 instructions: fee payment, account init');
    }
    const [, instruction] = instructions;

    if (!instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
        throw new Error('account instruction should call associated token program');
    }

    const [payerMeta, ataMeta, ownerMeta, mintMeta] = instruction.keys;

    const associatedToken = await getAssociatedTokenAddress(mintMeta.pubkey, ownerMeta.pubkey);

    // Check if account isn't already created
    if (await connection.getAccountInfo(associatedToken, 'confirmed')) {
        throw new Error('account already exists');
    }

    // Verify the payer is the fee payer (Octane) and the created account is the
    // correct ATA. We check the meaningful fields directly instead of
    // areInstructionsEqual, which breaks across spl-token versions (the rent
    // sysvar account was removed from the ATA instruction).
    if (!payerMeta.pubkey.equals(feePayer.publicKey)) {
        throw new Error('account init payer must be the fee payer');
    }
    if (!ataMeta.pubkey.equals(associatedToken)) {
        throw new Error('account init creates the wrong associated token account');
    }

    // Prevent trying to create same accounts too many times within a short timeframe (per one recent blockhash)
    const key = `account/${transaction.recentBlockhash}_${associatedToken.toString()}`;
    if (await cache.get(key)) throw new Error('duplicate account within same recent blockhash');
    await cache.set(key, true);
}
