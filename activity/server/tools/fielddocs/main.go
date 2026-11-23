// Command fielddocs checks struct field comments in production source files.
package main

import (
	"bufio"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"os"
)

// check reads one Go source filename per line and reports undocumented fields.
func check(input io.Reader) error {
	sources := bufio.NewScanner(input)
	var problems []error
	for sources.Scan() {
		positions := token.NewFileSet()
		file, err := parser.ParseFile(positions, sources.Text(), nil, parser.ParseComments)
		if err != nil {
			problems = append(problems, err)
			continue
		}
		ast.Inspect(file, func(node ast.Node) bool {
			record, ok := node.(*ast.StructType)
			if !ok {
				return true
			}
			for _, field := range record.Fields.List {
				if field.Doc.Text() == "" && field.Comment.Text() == "" {
					position := positions.Position(field.Pos())
					problems = append(problems,
						fmt.Errorf("%s: struct field needs a doc comment", position),
					)
				}
			}
			return true
		})
	}
	return errors.Join(append(problems, sources.Err())...)
}

// main reports field documentation failures and sets the command status.
func main() {
	if err := check(os.Stdin); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
