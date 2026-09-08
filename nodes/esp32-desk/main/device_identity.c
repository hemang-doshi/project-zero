#include "device_identity.h"
#include "esp_err.h"
#include "esp_random.h"
#include "mbedtls/pk.h"
#include "mbedtls/sha256.h"
#include "mbedtls/x509_csr.h"
#include <stdio.h>
#include <string.h>
static int rng(void *ctx, unsigned char *out, size_t n) {
  (void)ctx;
  esp_fill_random(out, n);
  return 0;
}
void device_identity(nvs_handle_t nvs, char *key, size_t key_size, char *csr,
                     size_t csr_size, char fp[65]) {
  mbedtls_pk_context pk;
  mbedtls_pk_init(&pk);
  size_t n = key_size;
  if (nvs_get_str(nvs, "private_key", key, &n) == ESP_ERR_NVS_NOT_FOUND) {
    ESP_ERROR_CHECK(
        mbedtls_pk_setup(&pk, mbedtls_pk_info_from_type(MBEDTLS_PK_ECKEY)));
    ESP_ERROR_CHECK(mbedtls_ecp_gen_key(MBEDTLS_ECP_DP_SECP256R1,
                                        mbedtls_pk_ec(pk), rng, NULL));
    ESP_ERROR_CHECK(
        mbedtls_pk_write_key_pem(&pk, (unsigned char *)key, key_size));
    ESP_ERROR_CHECK(nvs_set_str(nvs, "private_key", key));
    ESP_ERROR_CHECK(nvs_commit(nvs));
  } else
    ESP_ERROR_CHECK(mbedtls_pk_parse_key(&pk, (unsigned char *)key,
                                         strlen(key) + 1, NULL, 0, rng, NULL));
  mbedtls_x509write_csr req;
  mbedtls_x509write_csr_init(&req);
  mbedtls_x509write_csr_set_md_alg(&req, MBEDTLS_MD_SHA256);
  mbedtls_x509write_csr_set_key(&req, &pk);
  ESP_ERROR_CHECK(
      mbedtls_x509write_csr_set_subject_name(&req, "CN=desk-display-01"));
  ESP_ERROR_CHECK(mbedtls_x509write_csr_pem(&req, (unsigned char *)csr,
                                            csr_size, rng, NULL));
  unsigned char der[256], digest[32];
  int len = mbedtls_pk_write_pubkey_der(&pk, der, sizeof(der));
  ESP_ERROR_CHECK(len < 0 ? len : 0);
  ESP_ERROR_CHECK(mbedtls_sha256(der + sizeof(der) - len, len, digest, 0));
  for (int i = 0; i < 32; i++)
    sprintf(fp + 2 * i, "%02x", digest[i]);
  fp[64] = 0;
  mbedtls_x509write_csr_free(&req);
  mbedtls_pk_free(&pk);
}
