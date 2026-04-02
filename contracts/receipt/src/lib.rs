#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Receipt(BytesN<32>),
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct Receipt {
    pub payer: Address,
    pub payee: Address,
    pub token: Address,
    pub amount: i128,
    pub result_hash: BytesN<32>,
    pub ledger: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ReceiptError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    InvalidAmount = 3,
    ReceiptExists = 4,
}

pub trait ReceiptInterface {
    fn init(env: Env, admin: Address);
    fn admin(env: Env) -> Address;
    fn set_admin(env: Env, new_admin: Address);
    fn issue(
        env: Env,
        id: BytesN<32>,
        payer: Address,
        payee: Address,
        token: Address,
        amount: i128,
        result_hash: BytesN<32>,
    );
    fn get(env: Env, id: BytesN<32>) -> Option<Receipt>;
}

#[contract]
pub struct ReceiptContract;

#[contractimpl]
impl ReceiptContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, ReceiptError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);

        env.events().publish((symbol_short!("init"),), admin);
    }

    pub fn admin(env: Env) -> Address {
        read_admin(&env)
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin = read_admin(&env);
        admin.require_auth();

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.events().publish((symbol_short!("setadmin"),), new_admin);
    }

    pub fn issue(
        env: Env,
        id: BytesN<32>,
        payer: Address,
        payee: Address,
        token: Address,
        amount: i128,
        result_hash: BytesN<32>,
    ) {
        let admin = read_admin(&env);
        admin.require_auth();

        if amount <= 0 {
            panic_with_error!(&env, ReceiptError::InvalidAmount);
        }

        let key = DataKey::Receipt(id.clone());
        if env.storage().persistent().has(&key) {
            panic_with_error!(&env, ReceiptError::ReceiptExists);
        }

        let receipt = Receipt {
            payer,
            payee,
            token,
            amount,
            result_hash,
            ledger: env.ledger().sequence(),
        };

        env.storage().persistent().set(&key, &receipt);
        env.events().publish((symbol_short!("issued"), id), receipt);
    }

    pub fn get(env: Env, id: BytesN<32>) -> Option<Receipt> {
        env.storage().persistent().get(&DataKey::Receipt(id))
    }
}

fn read_admin(env: &Env) -> Address {
    match env.storage().instance().get(&DataKey::Admin) {
        Some(admin) => admin,
        None => panic_with_error!(env, ReceiptError::Unauthorized),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn placeholder_receipt_test() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(ReceiptContract, ());
        let client = ReceiptContractClient::new(&env, &contract_id);

        client.init(&admin);
        assert_eq!(client.admin(), admin);
    }
}
