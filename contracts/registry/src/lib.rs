#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, String, Vec,
};

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct ContractListing {
    pub contract_id: BytesN<32>,
    pub owner: Address,
    pub name: String,
    pub endpoint: String,
    pub price_stroops: i128,
    pub active: bool,
    pub total_calls: u64,
    pub successful_calls: u64,
    pub registered_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Listing(BytesN<32>),
    Index(u32),
    Count,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum RegistryError {
    AlreadyInitialized = 1,
    Unauthorized = 2,
    NotInitialized = 3,
    InvalidPrice = 4,
    ContractAlreadyRegistered = 5,
    ContractNotFound = 6,
    Overflow = 7,
}

#[contract]
pub struct RegistryContract;

#[contractimpl]
impl RegistryContract {
    pub fn init(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic_with_error!(&env, RegistryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::Count, &0_u32);

        env.events().publish((symbol_short!("init"),), admin);
    }

    pub fn register(
        env: Env,
        owner: Address,
        contract_id: BytesN<32>,
        name: String,
        endpoint: String,
        price_stroops: i128,
    ) {
        ensure_initialized(&env);
        owner.require_auth();

        if price_stroops <= 0 {
            panic_with_error!(&env, RegistryError::InvalidPrice);
        }

        let listing_key = DataKey::Listing(contract_id.clone());
        if env.storage().persistent().has(&listing_key) {
            panic_with_error!(&env, RegistryError::ContractAlreadyRegistered);
        }

        let listing = ContractListing {
            contract_id: contract_id.clone(),
            owner,
            name,
            endpoint,
            price_stroops,
            active: true,
            total_calls: 0,
            successful_calls: 0,
            registered_at: env.ledger().timestamp(),
        };

        let count = read_count(&env);
        env.storage().persistent().set(&listing_key, &listing);
        env.storage()
            .persistent()
            .set(&DataKey::Index(count), &contract_id);

        let next_count = count.checked_add(1).unwrap_or_else(|| {
            panic_with_error!(&env, RegistryError::Overflow);
        });
        env.storage().persistent().set(&DataKey::Count, &next_count);

        env.events()
            .publish((symbol_short!("register"), contract_id), listing.price_stroops);
    }

    pub fn get(env: Env, contract_id: BytesN<32>) -> ContractListing {
        ensure_initialized(&env);
        read_listing(&env, &contract_id)
    }

    pub fn list(env: Env, offset: u32, limit: u32) -> Vec<ContractListing> {
        ensure_initialized(&env);
        let mut out = Vec::new(&env);
        if limit == 0 {
            return out;
        }

        let count = read_count(&env);
        if offset >= count {
            return out;
        }

        let mut i = offset;
        let end = offset.saturating_add(limit).min(count);
        while i < end {
            let contract_id: BytesN<32> = env
                .storage()
                .persistent()
                .get(&DataKey::Index(i))
                .unwrap_or_else(|| panic_with_error!(&env, RegistryError::ContractNotFound));
            out.push_back(read_listing(&env, &contract_id));
            i += 1;
        }

        out
    }

    pub fn record_invocation(env: Env, contract_id: BytesN<32>, success: bool) {
        let admin = read_admin(&env);
        admin.require_auth();

        let mut listing = read_listing(&env, &contract_id);
        listing.total_calls = listing.total_calls.checked_add(1).unwrap_or_else(|| {
            panic_with_error!(&env, RegistryError::Overflow);
        });

        if success {
            listing.successful_calls = listing.successful_calls.checked_add(1).unwrap_or_else(|| {
                panic_with_error!(&env, RegistryError::Overflow);
            });
        }

        env.storage()
            .persistent()
            .set(&DataKey::Listing(contract_id.clone()), &listing);

        env.events()
            .publish((symbol_short!("invoke"), contract_id), success);
    }

    pub fn set_active(env: Env, contract_id: BytesN<32>, active: bool) {
        ensure_initialized(&env);
        let mut listing = read_listing(&env, &contract_id);
        listing.owner.require_auth();

        listing.active = active;
        env.storage()
            .persistent()
            .set(&DataKey::Listing(contract_id), &listing);
    }

    pub fn reputation(env: Env, contract_id: BytesN<32>) -> u32 {
        ensure_initialized(&env);
        let listing = read_listing(&env, &contract_id);

        if listing.total_calls == 0 {
            return 500;
        }

        ((listing.successful_calls as u128 * 1000_u128) / listing.total_calls as u128) as u32
    }
}

fn read_admin(env: &Env) -> Address {
    match env.storage().persistent().get(&DataKey::Admin) {
        Some(admin) => admin,
        None => panic_with_error!(env, RegistryError::NotInitialized),
    }
}

fn ensure_initialized(env: &Env) {
    if !env.storage().persistent().has(&DataKey::Admin) {
        panic_with_error!(env, RegistryError::NotInitialized);
    }
}

fn read_count(env: &Env) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::Count)
        .unwrap_or(0_u32)
}

fn read_listing(env: &Env, contract_id: &BytesN<32>) -> ContractListing {
    env.storage()
        .persistent()
        .get(&DataKey::Listing(contract_id.clone()))
        .unwrap_or_else(|| panic_with_error!(env, RegistryError::ContractNotFound))
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String};

    #[test]
    fn register_and_get_happy_path() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let listed_contract_id = BytesN::from_array(&env, &[7_u8; 32]);
        let name = String::from_str(&env, "Echo");
        let endpoint = String::from_str(&env, "https://api.synapse.test/echo");

        client.init(&admin);
        client.register(&owner, &listed_contract_id, &name, &endpoint, &100_i128);

        let listing = client.get(&listed_contract_id);
        assert_eq!(listing.contract_id, listed_contract_id);
        assert_eq!(listing.owner, owner);
        assert_eq!(listing.name, name);
        assert_eq!(listing.endpoint, endpoint);
        assert_eq!(listing.price_stroops, 100_i128);
        assert!(listing.active);
        assert_eq!(listing.total_calls, 0_u64);
        assert_eq!(listing.successful_calls, 0_u64);
    }

    #[test]
    fn reputation_defaults_to_500_when_no_calls() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, RegistryContract);
        let client = RegistryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let listed_contract_id = BytesN::from_array(&env, &[9_u8; 32]);
        let name = String::from_str(&env, "Compute");
        let endpoint = String::from_str(&env, "https://api.synapse.test/compute");

        client.init(&admin);
        client.register(&owner, &listed_contract_id, &name, &endpoint, &250_i128);

        let score = client.reputation(&listed_contract_id);
        assert_eq!(score, 500_u32);
    }
}
