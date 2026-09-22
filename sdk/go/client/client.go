package client

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"github.com/hemang-doshi/project-zero/core/runtime"
	"time"
)

type Client struct{ http *http.Client }

func New(socket string) *Client {
	return &Client{&http.Client{Timeout: 10 * time.Second, Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", socket)
	}}}}
}
func (c *Client) Call(ctx context.Context, method, path string, input, out any) error {
	var b io.Reader
	if input != nil {
		data, e := json.Marshal(input)
		if e != nil {
			return e
		}
		b = bytes.NewReader(data)
	}
	q, e := http.NewRequestWithContext(ctx, method, "http://localhost/v0.1/"+path, b)
	if e != nil {
		return e
	}
	q.Header.Set("Content-Type", "application/json")
	resp, e := c.http.Do(q)
	if e != nil {
		return e
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		var v map[string]string
		json.NewDecoder(resp.Body).Decode(&v)
		return fmt.Errorf("%s", v["error"])
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(out)
}
func (c *Client) Get(ctx context.Context, path string, out any) error {
	return c.Call(ctx, "GET", path, nil, out)
}
func (c *Client) Execute(ctx context.Context, q runtime.Request) (runtime.Response, error) {
	var v runtime.Response
	e := c.Call(ctx, "POST", "commands", q, &v)
	return v, e
}
