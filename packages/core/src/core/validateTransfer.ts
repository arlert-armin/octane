import {
    DecodedTransferCheckedInstruction,
    DecodedTransferInstruction,
    decodeInstruction,
    getAccount,
    isTransferCheckedInstruction,
    isTransferInstruction,
} from '@solana/spl-token';
import { Connection, Transaction } from '@solana/web3.js';
import { TokenFee } from './tokenFee';

// Check that a transaction contains a valid transfer to Octane's token account
export async function validateTransfer(
    connection: Connection,
    transaction: Transaction,
    allowedTokens: TokenFee[]
): Promise<DecodedTransferInstruction | DecodedTransferCheckedInstruction> {
    if (!transaction.instructions.length) throw new Error('missing instructions');

    // Find the SPL Token transfer that pays Octane's fee. Wallets (e.g. Phantom)
    // may prepend ComputeBudget priority-fee instructions, so the fee transfer
    // isn't necessarily the first instruction.
    let instruction: DecodedTransferInstruction | DecodedTransferCheckedInstruction | undefined;
    for (const ix of transaction.instructions) {
        let decoded: DecodedTransferInstruction | DecodedTransferCheckedInstruction;
        try {
            const d = decodeInstruction(ix);
            if (!(isTransferInstruction(d) || isTransferCheckedInstruction(d))) continue;
            decoded = d;
        } catch {
            continue; // not an SPL Token instruction (ComputeBudget, etc.)
        }
        // Match the transfer whose destination is one of Octane's fee accounts.
        if (allowedTokens.some((token) => token.account.equals(decoded.keys.destination.pubkey))) {
            instruction = decoded;
            break;
        }
    }
    if (!instruction) throw new Error('no token fee transfer to Octane found');

    const {
        keys: { source, destination, owner },
        data: { amount },
    } = instruction;

    // Check that the source account exists, has the correct owner, is not frozen, and has enough funds
    const account = await getAccount(connection, source.pubkey, 'confirmed');
    if (!account.owner.equals(owner.pubkey)) throw new Error('source invalid owner');
    if (account.isFrozen) throw new Error('source frozen');
    if (account.amount < amount) throw new Error('source insufficient balance');

    // Check that the source account's mint is one of the accepted tokens
    const token = allowedTokens.find((token) => token.mint.equals(account.mint));
    if (!token) throw new Error('invalid token');

    // Check that the instruction is going to pay the fee
    if (amount < token.fee) throw new Error('invalid amount');

    // Check that the instruction has a valid source account
    if (!source.isWritable) throw new Error('source not writable');
    if (source.isSigner) throw new Error('source is signer');

    // Check that the destination account is Octane's and is valid
    if (!destination.pubkey.equals(token.account)) throw new Error('invalid destination');
    if (!destination.isWritable) throw new Error('destination not writable');
    if (destination.isSigner) throw new Error('destination is signer');

    // Check that the owner of the source account is valid and has signed
    if (!owner.pubkey.equals(transaction.signatures[1].publicKey)) throw new Error('owner missing signature');
    if (owner.isWritable) throw new Error('owner is writable');
    if (!owner.isSigner) throw new Error('owner not signer');

    // If the instruction is a `TransferChecked` instruction, check that the mint and decimals are valid
    if (isTransferCheckedInstruction(instruction)) {
        const {
            keys: { mint },
            data: { decimals },
        } = instruction;

        if (decimals !== token.decimals) throw new Error('invalid decimals');

        if (!mint.pubkey.equals(token.mint)) throw new Error('invalid mint');
        if (mint.isWritable) throw new Error('mint is writable');
        if (mint.isSigner) throw new Error('mint is signer');
    }

    return instruction;
}
