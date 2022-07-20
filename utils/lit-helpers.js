import LitJsSdk from 'lit-js-sdk'
import { toUtf8Bytes } from "@ethersproject/strings";
import { hexlify } from "@ethersproject/bytes";
import { blobToBase64, decodeb64, buf2hex, getAddressFromDid } from "./index.js";

/** Initialize lit */
let lit;
export function connectLit() {
  lit = new LitJsSdk.LitNodeClient({alertWhenUnauthorized: false})
  lit.connect()
}

/** Requires user to sign a message which will generate the lit-signature */
export async function generateLitSignature(provider, account) {
  let signedMessage;

  /** Initiate the signature data */
  const now = new Date().toISOString();
  const AUTH_SIGNATURE_BODY = "I am creating an account to use the private features of Orbis at {{timestamp}}";
  const body = AUTH_SIGNATURE_BODY.replace("{{timestamp}}", now);
  const bodyBytes = toUtf8Bytes(body);

  /** Proceed to signing the message */
  try {
    signedMessage = await provider.send('personal_sign', [ hexlify(bodyBytes), account ]);

    /** Save signature for authentication */
    let sig = JSON.stringify({
        sig: signedMessage.result,
        derivedVia: "web3.eth.personal.sign",
        signedMessage: body,
        address: account,
    });
    localStorage.setItem("lit-auth-signature-" + account, sig);
    localStorage.setItem("lit-auth-signature", sig);

    return {
      status: 200,
      result: "Created lit signature with success."
    }
  } catch (e) {
    console.log("Error generating signature for Lit: ", e);
    return {
      status: 300,
      result: "Error generating signature for Lit.",
      error: e
    };
  }
}

/** Retrieve user's authsig from localStorage */
function getAuthSig() {
  const authSig = JSON.parse(localStorage.getItem("lit-auth-signature"));
  if(authSig && authSig != "") {
    return authSig;
  } else {
    console.log("User not authenticated to Lit Protocol for messages")
    throw new Error("User not authenticated to Lit Protocol for messages");
  }
}

/** Decrypt a string using Lit based on a set of inputs. */
export async function decryptString(encryptedMessage) {
  /** Retrieve AuthSig */
  let authSig = getAuthSig();

  /** Decode string encoded as b64 to be supported by Ceramic */
  let decodedString;
  try {
    decodedString = decodeb64(encryptedMessage.encryptedString);
  } catch(e) {
    console.log("Error decoding b64 string: ", e);
    throw new Error(e);
  }

  let _access;
  try {
    _access = JSON.parse(encryptedMessage.accessControlConditions);
  } catch(e) {
    console.log("Couldn't parse accessControlConditions: ", e);
    throw new Error(e);
  }


  /** Get encryption key from Lit */
  let decryptedSymmKey;
  try {
    decryptedSymmKey = await lit.getEncryptionKey({
        accessControlConditions: _access,
        toDecrypt: encryptedMessage.encryptedSymmetricKey,
        chain: 'ethereum',
        authSig
    })
  } catch(e) {
    console.log("Error getting encryptionKey: ", e);
    throw new Error(e);
  }

  /** Decrypt the string using the encryption key */
  try {
      const decryptedString = await LitJsSdk.decryptString(new Blob([decodedString]), decryptedSymmKey);
      return {
        status: 200,
        result: decryptedString
      };
  } catch(e) {
    console.log("Error decrypting string: ", e)
    throw new Error(e);
  }
}

/** Encryp a DM */
export async function encryptDM(recipients, message) {
  /** Step 1: Retrieve access control conditions from recipients */
  let accessControlConditions = generateAccessControlConditionsForDMs(recipients);

  /** Step 2: Encrypt string and return result */
  try {
    let result = await encryptString(accessControlConditions, message);
    return result
  } catch(e) {
    console.log("Error encrypting DM: ", e);
    throw new Error(e)
  }
}

/** Encrypt string based on some access control conditions */
export async function encryptString(accessControlConditions, message) {
  /** Step 1: Retrieve AuthSig */
  let authSig = getAuthSig();

  /** Step 2: Encrypt message */
  const { encryptedString, symmetricKey } = await LitJsSdk.encryptString(message);

  /** We convert the encrypted string to base64 to make it work with Ceramic */
  let base64EncryptedString = await blobToBase64(encryptedString);

  /** Step 4: Save encrypted content to lit nodes */
  let encryptedSymmetricKey;
  try {
    encryptedSymmetricKey = await lit.saveEncryptionKey({
      accessControlConditions: accessControlConditions,
      symmetricKey: symmetricKey,
      authSig: authSig,
      chain: 'ethereum'
    });
  } catch(e) {
    console.log("Error encrypting string with Lit: ", e);
    throw new Error("Error encrypting string with Lit: " + e)
  }

  /** Step 5: Return encrypted content which will be stored on Ceramic (and needed to decrypt the content) */
  return {
    accessControlConditions: JSON.stringify(accessControlConditions),
    encryptedSymmetricKey: buf2hex(encryptedSymmetricKey),
    encryptedString: base64EncryptedString
  }
}

/** This function will take an array of recipients and turn it into a clean access control conditions array */
export function generateAccessControlConditionsForDMs(recipients) {
  let _accessControlConditions = [];

  /** Loop through each recipient */
  recipients.forEach((recipient, i) => {
    /** Get ETH address from DiD */
    let { address, network } = getAddressFromDid(recipient);
    console.log("Address recipient: " + address);
    console.log("network recipient: " + network);

    if(network == "eip155") {
      /** Push access control condition to array */
      _accessControlConditions.push({
        contractAddress: '',
        standardContractType: '',
        chain: 'ethereum',
        method: '',
        parameters: [
          ':userAddress',
        ],
        returnValueTest: {
          comparator: '=',
          value: address
        }
      })

      /** Push `or` operator if recipient isn't the last one of the list */
      if(i < recipients.length -1) {
        _accessControlConditions.push({"operator": "or"})
      }
    } else {
      /** For now ignore non-ethereum chains as they are not supported on Orbis */
    }


  });

  /** Return clean access control conditions */
  return _accessControlConditions;
}