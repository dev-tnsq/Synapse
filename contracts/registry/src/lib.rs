#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address, Env,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    ReceiptContract,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
}

pub trait RegistryInterface {
    fn init(env: Env, admin: Address);
    fn admin(env: Env) -> Address;
    fn set_receipt_contract(env: Env, receipt_contract: Address);
    fn receipt_contract(env: Env) -> Option<Address>;
}

#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic_with_error!(&env, RegistryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);

        env.events().publish((symbol_short!("init"),), admin);
    }

    pub fn admin(env: Env) -> Address {
        read_admin(&env)
    }

    pub fn set_receipt_contract(env: Env, receipt_contract: Address) {
        let admin = read_admin(&env);
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::ReceiptContract, &receipt_contract);

        env.events()
            .publish((symbol_short!("setrcpt"),), receipt_contract);
    }

    pub fn receipt_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::ReceiptContract)
    }
}

fn read_admin(env: &Env) -> Address {
    match env.storage().instance().get(&DataKey::Admin) {
        Some(admin) => admin,
        None => panic_with_error!(env, RegistryError::Unauthorized),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn placeholder_registry_test() {
        let env = Env::default();
        let admin = Address::generate(&env);

        let contract_id = env.register(RegistryContract, ());
        let client = RegistryContractClient::new(&env, &contract_id);

        client.init(&admin);
        assert_eq!(client.admin(), admin);
    }
}
