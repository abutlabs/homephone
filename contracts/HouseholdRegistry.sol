// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title HouseholdRegistry (milestone 4 sketch, NOT deployed, NOT audited)
/// @notice Which accounts belong to which household. Stores account addresses
/// only: no names, no phone numbers, no call records. Targets Polkadot Hub
/// (testnet first), where msg.sender for a Polkadot account is the H160 that
/// `homephone-identity` prints as "Polkadot Hub H160".
///
/// The ringing server reads this instead of households.json, and only rings
/// devices whose account is a member of the called household.
contract HouseholdRegistry {
    struct Household {
        address admin;
        bool exists;
        mapping(address => bool) members;
        mapping(address => bool) invited;
        uint32 memberCount;
    }

    mapping(bytes32 => Household) private households;

    event HouseholdCreated(bytes32 indexed id, address indexed admin);
    event Invited(bytes32 indexed id, address indexed account);
    event Joined(bytes32 indexed id, address indexed account);
    event Left(bytes32 indexed id, address indexed account);

    error AlreadyExists();
    error NotAdmin();
    error NotInvited();
    error NotMember();

    function create(bytes32 id) external {
        Household storage h = households[id];
        if (h.exists) revert AlreadyExists();
        h.exists = true;
        h.admin = msg.sender;
        h.members[msg.sender] = true;
        h.memberCount = 1;
        emit HouseholdCreated(id, msg.sender);
        emit Joined(id, msg.sender);
    }

    /// Invite a phone or a person's app account. They must accept.
    function invite(bytes32 id, address account) external {
        Household storage h = households[id];
        if (h.admin != msg.sender) revert NotAdmin();
        h.invited[account] = true;
        emit Invited(id, account);
    }

    function accept(bytes32 id) external {
        Household storage h = households[id];
        if (!h.invited[msg.sender]) revert NotInvited();
        h.invited[msg.sender] = false;
        if (!h.members[msg.sender]) {
            h.members[msg.sender] = true;
            h.memberCount += 1;
        }
        emit Joined(id, msg.sender);
    }

    function leave(bytes32 id) external {
        Household storage h = households[id];
        if (!h.members[msg.sender]) revert NotMember();
        h.members[msg.sender] = false;
        h.memberCount -= 1;
        emit Left(id, msg.sender);
    }

    function isMember(bytes32 id, address account) external view returns (bool) {
        return households[id].members[account];
    }

    function adminOf(bytes32 id) external view returns (address) {
        return households[id].admin;
    }
}
